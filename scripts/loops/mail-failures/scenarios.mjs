// The failure matrix. Each scenario breaks one thing in a running server and answers with named
// checks: true holds, false fails, null does not apply. A check is named for what must be true.
import { API_ROUTES, sleep, startCampaign, until } from "./lib/instance.mjs";
import {
  createWorld,
  deliveryAccounting,
  destroyWorld,
  duringFault,
  fastForwardBackoff,
  fastForwardLeases,
  isoAgo,
  MINUTE,
  mailboxError,
  noOrphanedRequest,
  requestRows,
  sqlRows,
  taskRows,
  told,
  verdict,
  waitOutLapsedLease,
} from "./lib/world.mjs";

const THREE = ["fx-complete", "fx-ack", "fx-reject"];
const DAY = 24 * 60 * MINUTE;
const DOCKER_GRACE_MS = 10_000;

const delivered = (world, count, timeoutMs) =>
  until(() => world.fake.delivered.length >= count, timeoutMs, 500);

async function liveness(world, peak, extra = {}) {
  return {
    told: await told(world),
    delivery: await deliveryAccounting(world),
    live_task: await noOrphanedRequest(world),
    scheduler_fresh: peak.scheduler,
    poll_starts: peak.poll,
    ...extra,
  };
}

async function smtpAuthRevoked(world) {
  world.fake.mode.smtp = "auth_rejected";
  await startCampaign(world.instance, world.profileId, THREE);
  await sleep(25_000);
  const peak = await duringFault(world);
  const attempts = (await taskRows(world)).map((task) => task.attempts);
  world.notes.push(`attempts spent while the password was rejected: ${attempts.join(",")}`);

  world.fake.mode.smtp = "accept";
  await world.instance.api.call(API_ROUTES.mailboxSave, {
    params: { id: world.profileId },
    body: world.mailboxBody,
  });
  const recovered = await until(() => world.fake.delivered.length >= THREE.length, 90_000);
  return liveness(world, peak, {
    no_attempt_spent: attempts.every((n) => n === 0),
    sends_after_fix: Boolean(recovered),
  });
}

async function imapAuthRevoked(world) {
  world.fake.mode.imap = "auth_failed";
  await world.instance.api.call(API_ROUTES.mailboxPoll, { params: { id: world.profileId } });
  await until(async () => (await mailboxError(world)) !== null, 25_000);
  await startCampaign(world.instance, world.profileId, ["fx-complete"]);
  await delivered(world, 1, 45_000);
  const stillShown = (await mailboxError(world)) !== null;
  if (!stillShown) world.notes.push("a successful send cleared the poll failure");
  const peak = await duringFault(world);
  return {
    told: stillShown || (await told(world)),
    delivery: await deliveryAccounting(world),
    live_task: await noOrphanedRequest(world),
    scheduler_fresh: peak.scheduler,
    poll_starts: peak.poll,
    poll_error_survives_send: stillShown,
  };
}

async function smtpSilent(world) {
  world.fake.mode.smtp = "silent";
  await startCampaign(world.instance, world.profileId, THREE);
  await sleep(4_000);
  const peak = await duringFault(world);
  await sleep(35_000);
  return liveness(world, peak, {
    no_attempt_spent: (await taskRows(world)).every((t) => t.attempts === 0),
  });
}

async function dropAfterData(world) {
  world.fake.mode.smtp = "drop_after_data";
  await startCampaign(world.instance, world.profileId, ["fx-complete"]);
  await until(() => world.fake.delivered.length >= 1, 30_000);
  const peak = await duringFault(world);
  await sleep(40_000);
  return liveness(world, peak);
}

/** Holds one send open past DATA, so the server has the mail but the sender has no answer yet. */
async function startUnacknowledgedSend(world) {
  world.fake.mode.smtp = "hang_after_data";
  await startCampaign(world.instance, world.profileId, ["fx-complete"]);
  const reached = await delivered(world, 1, 30_000);
  if (!reached) throw new Error("the send never reached DATA");
  return world.fake.delivered[0].id;
}

async function resumeAfterRestart(world, flow) {
  world.fake.mode.smtp = "accept";
  const up = await world.instance.start();
  if (!up) throw new Error("the server did not restart");
  await world.instance.api.call(API_ROUTES.authLogin, {
    body: { password: "correct horse battery staple" },
  });
  return flow();
}

async function sigkillMidSend(world) {
  await startUnacknowledgedSend(world);
  await world.instance.stop("SIGKILL", 10_000);
  const peak = await resumeAfterRestart(world, async () => {
    await waitOutLapsedLease(world, 45);
    return duringFault(world);
  });
  return liveness(world, peak, {
    request_finishes: (await requestRows(world)).every((r) => r.status !== "queued"),
  });
}

async function sigtermMidSend(world) {
  await startUnacknowledgedSend(world);
  const exitMs = await world.instance.stop("SIGTERM", 60_000);
  world.notes.push(`exit took ${exitMs === null ? "more than 60" : Math.round(exitMs / 1000)}s`);
  const peak = await resumeAfterRestart(world, async () => {
    await waitOutLapsedLease(world, 45);
    return duringFault(world);
  });
  return liveness(world, peak, {
    exits_within_container_grace: exitMs !== null && exitMs <= DOCKER_GRACE_MS,
  });
}

async function shutdownKeepsAttempt(world) {
  const id = await startUnacknowledgedSend(world);
  await world.instance.stop("SIGTERM", 60_000);
  const [task] = await taskRows(world);
  world.notes.push(`after shutdown: ${task?.status} attempts=${task?.attempts}`);
  const keptAttempt = task?.attempts >= 1;
  const resentAtOnce = await resumeAfterRestart(world, async () => {
    await sleep(30_000);
    return world.fake.deliveriesOf(id) > 1;
  });
  if (resentAtOnce) world.notes.push("the restart delivered the same Message-ID again");
  return {
    attempt_kept_by_shutdown: keptAttempt,
    not_resent_by_restart: !resentAtOnce,
    live_task: await noOrphanedRequest(world),
  };
}

async function refusedConnection(world) {
  await startCampaign(world.instance, world.profileId, ["fx-complete", "fx-ack"]);
  await until(async () => (await mailboxError(world)) !== null, 45_000);
  const peak = await duringFault(world);
  const tasks = await taskRows(world);
  world.notes.push(`attempts after refused connects: ${tasks.map((t) => t.attempts).join(",")}`);
  return liveness(world, peak, {
    no_attempt_spent: tasks.every((task) => task.attempts === 0 && task.status === "queued"),
    mailbox_pause_shown: (world.mailboxErrorAtPeak ?? "").includes("Sending is paused"),
    pause_survives_next_poll: ((await mailboxError(world)) ?? "").includes("Sending is paused"),
  });
}

async function holdAfterLeaseLapse(world) {
  world.fake.mode.smtp = "auth_rejected_late";
  world.fake.mode.delayMs = 14_000;
  await startCampaign(world.instance, world.profileId, ["fx-complete"]);
  await until(() => world.fake.smtpConnections.length >= 1, 20_000);
  await sleep(1_500);
  await fastForwardLeases(world);
  await sleep(24_000);
  const log = world.instance.log();
  const lost = /lease_not_held/.test(log);
  if (lost) world.notes.push("the hold threw lease_not_held");
  const peak = await duringFault(world);
  return liveness(world, peak, {
    mailbox_error_kept: (world.mailboxErrorAtPeak ?? "").includes("Sending is paused"),
    hold_does_not_throw: !lost,
  });
}

async function diskFull(world) {
  world.fake.mode.smtp = "slow_250";
  world.fake.mode.delayMs = 8_000;
  await startCampaign(world.instance, world.profileId, ["fx-complete"]);
  await delivered(world, 1, 30_000);
  await world.instance.exec("dd if=/dev/zero of=/data/fill bs=1k 2>/dev/null; true");
  await sleep(14_000);

  const health = await world.instance.api.try(API_ROUTES.health);
  const write = await world.instance.api.try(API_ROUTES.mailboxSave, {
    params: { id: world.profileId },
    body: world.mailboxBody,
  });
  const named = typeof write.body === "object" ? write.body?.error : null;
  world.notes.push(`full disk: health ${health.status}, write ${write.status} ${named ?? ""}`);
  const peak = await duringFault(world);

  await world.instance.exec("rm -f /data/fill");
  world.fake.mode.smtp = "accept";
  await waitOutLapsedLease(world, 45);
  return {
    told: health.status === 503 || (Boolean(named) && named !== "internal_error"),
    delivery: await deliveryAccounting(world),
    live_task: await noOrphanedRequest(world),
    scheduler_fresh: peak.scheduler,
    poll_starts: peak.poll,
    request_finishes: (await requestRows(world)).every((r) => r.status !== "queued"),
  };
}

async function clockJump(world) {
  await startCampaign(world.instance, world.profileId, ["fx-complete", "fx-ack", "fx-captcha"]);
  await delivered(world, 2, 40_000);
  const claimed = await world.instance.api.call(API_ROUTES.workerClaim, {
    body: { workerId: "loop-worker", leaseMs: 60_000 },
  });
  await world.instance.stop("SIGTERM", 30_000);
  world.notes.push(`worker claimed a task under the skewed clock: ${Boolean(claimed.task)}`);

  const up = await world.instance.start();
  if (!up) throw new Error("the server did not restart on the real clock");
  await world.instance.api.call(API_ROUTES.authLogin, {
    body: { password: "correct horse battery staple" },
  });
  const before = world.fake.delivered.length;
  await startCampaign(world.instance, world.profileId, ["fx-norecord"]);
  const sentAgain = await until(() => world.fake.delivered.length > before, 90_000);
  const [lease] = await sqlRows(
    world,
    "select max(lease_expires_at) as at from tasks where status = 'leased'",
  );
  const stuckFor = lease?.at ? Date.parse(lease.at) - Date.now() : 0;
  if (stuckFor > 60 * MINUTE)
    world.notes.push(`a lease runs ${Math.round((stuckFor / DAY) * 10) / 10} days ahead`);
  const peak = await duringFault(world);
  return {
    delivery: await deliveryAccounting(world),
    live_task: await noOrphanedRequest(world),
    scheduler_fresh: peak.scheduler,
    poll_starts: peak.poll,
    send_flows_after_correction: Boolean(sentAgain),
    no_lease_in_the_future: stuckFor <= 60 * MINUTE,
  };
}

async function workerOffline(world) {
  const api = world.instance.api;
  await api.call(API_ROUTES.workerHeartbeat, { body: { workerId: "loop-worker", busy: false } });
  await startCampaign(world.instance, world.profileId, ["fx-captcha"]);
  const [row] = await sqlRows(
    world,
    "select value from settings where key = 'worker.status.builtin'",
  );
  const status = JSON.parse(row.value);
  status.lastSeenAt = isoAgo(DAY);
  await sqlRows(world, "update settings set value = ? where key = 'worker.status.builtin'", [
    JSON.stringify(status),
  ]);
  const peak = await duringFault(world);
  const tasks = await taskRows(world);
  return {
    told: await told(world),
    live_task: await noOrphanedRequest(world),
    scheduler_fresh: peak.scheduler,
    poll_starts: peak.poll,
    work_kept_waiting: tasks.some((task) => task.status === "queued"),
  };
}

async function leaseLost(world) {
  const api = world.instance.api;
  await startCampaign(world.instance, world.profileId, ["fx-captcha"]);
  const claimed = await api.call(API_ROUTES.workerClaim, {
    body: { workerId: "loop-worker", leaseMs: 10_000 },
  });
  if (!claimed.task) throw new Error("no browser task to claim");
  await sleep(22_000);
  const [lapsed] = await taskRows(world);
  world.notes.push(`after the lease lapsed: ${lapsed?.status} attempts=${lapsed?.attempts}`);
  const peak = await duringFault(world);
  await fastForwardBackoff(world);
  const again = await api.call(API_ROUTES.workerClaim, {
    body: { workerId: "other-worker", leaseMs: 60_000 },
  });
  return {
    delivery: await deliveryAccounting(world),
    live_task: await noOrphanedRequest(world),
    scheduler_fresh: peak.scheduler,
    poll_starts: peak.poll,
    task_back_in_queue: ["queued", "blocked"].includes(lapsed?.status),
    task_claimable_again: Boolean(again.task),
  };
}

async function restoreOldBackup(world) {
  world.fake.mode.smtp = "greeting_421";
  await startCampaign(world.instance, world.profileId, THREE);
  await sleep(6_000);
  await world.instance.stop("SIGTERM", 30_000);
  const backup = await world.instance.snapshot();

  world.fake.mode.smtp = "accept";
  if (!(await world.instance.start())) throw new Error("the server did not restart");
  await world.instance.api.call(API_ROUTES.authLogin, {
    body: { password: "correct horse battery staple" },
  });
  await sleep(500);
  await world.instance.api.call(API_ROUTES.mailboxSave, {
    params: { id: world.profileId },
    body: world.mailboxBody,
  });
  await delivered(world, THREE.length, 90_000);
  await sleep(3_000);
  await world.instance.stop("SIGTERM", 30_000);

  await world.instance.restore(backup);
  if (!(await world.instance.start())) throw new Error("the restored server did not start");
  await world.instance.api.call(API_ROUTES.authLogin, {
    body: { password: "correct horse battery staple" },
  });
  await sleep(1_000);
  await world.instance.api.call(API_ROUTES.mailboxSave, {
    params: { id: world.profileId },
    body: world.mailboxBody,
  });
  await sleep(45_000);
  const peak = await duringFault(world);
  return {
    delivery: await deliveryAccounting(world),
    live_task: await noOrphanedRequest(world),
    scheduler_fresh: peak.scheduler,
    poll_starts: peak.poll,
  };
}

export const SCENARIOS = [
  { name: "smtp_auth_revoked", run: smtpAuthRevoked },
  { name: "imap_auth_revoked", run: imapAuthRevoked },
  { name: "smtp_silent", run: smtpSilent },
  { name: "drop_after_data", run: dropAfterData },
  { name: "sigkill_mid_send", run: sigkillMidSend },
  { name: "sigterm_mid_send", run: sigtermMidSend },
  {
    name: "disk_full",
    run: diskFull,
    world: { instance: { container: true }, skipFirstPoll: false },
  },
  { name: "clock_jump_3_days", run: clockJump, world: { start: { skewMs: 3 * DAY } } },
  { name: "worker_offline", run: workerOffline },
  { name: "lease_lost", run: leaseLost },
  { name: "restore_old_backup", run: restoreOldBackup },
  { name: "review_shutdown_keeps_attempt", run: shutdownKeepsAttempt },
  { name: "review_refused_connection", run: refusedConnection, world: { refusedPort: true } },
  { name: "review_hold_after_lease_lapse", run: holdAfterLeaseLapse },
];

export async function runScenario(scenario, workDir) {
  const startedAt = Date.now();
  let world = null;
  try {
    world = await createWorld(workDir, scenario.name, scenario.world);
    const checks = await scenario.run(world);
    return { ...verdict(world, checks), seconds: Math.round((Date.now() - startedAt) / 1000) };
  } catch (error) {
    return {
      name: scenario.name,
      checks: { scenario_ran: false },
      notes: [String(error.message ?? error).split("\n")[0]],
      seconds: Math.round((Date.now() - startedAt) / 1000),
    };
  } finally {
    if (world) await destroyWorld(world);
  }
}
