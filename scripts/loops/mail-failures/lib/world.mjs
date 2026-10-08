// A scenario's surroundings and the invariants every scenario is judged by.
import { mkdirSync } from "node:fs";
import { closedPort, startFakeMail } from "./fakemail.mjs";
import {
  API_ROUTES,
  bootstrap,
  dashboard,
  Instance,
  sleep,
  startPushSink,
  until,
} from "./instance.mjs";

const TELL_WINDOW_MS = 75_000;
const POLL_START_WINDOW_MS = 12_000;
const SCHEDULER_MAX_AGE_MS = 30_000;
export const MINUTE = 60_000;

export async function createWorld(workDir, name, options = {}) {
  mkdirSync(workDir, { recursive: true });
  const fake = await startFakeMail();
  const push = await startPushSink();
  const instance = new Instance({ workDir, name, ...options.instance });
  const world = { name, fake, push, instance, profileId: null, mailboxBody: null, notes: [] };
  const up = await instance.start(options.start);
  if (!up) throw new Error(`${name}: the server did not come up\n${instance.log().slice(-600)}`);
  const smtpPort = options.refusedPort ? await closedPort() : fake.smtpPort;
  Object.assign(world, await bootstrap(instance, fake, { push, smtpPort }));
  if (!options.skipFirstPoll) {
    await until(
      async () => (await dashboard(instance, world.profileId))?.mailbox?.lastPolledAt,
      20_000,
    );
  }
  return world;
}

export async function destroyWorld(world) {
  await world.instance.cleanup();
  await world.fake.close();
  await world.push.close();
}

export const sqlRows = (world, statement, params) => world.instance.sql(statement, params);

export const taskRows = (world) =>
  sqlRows(
    world,
    "select id, kind, status, attempts, max_attempts, lease_owner, lease_expires_at, run_after, last_error from tasks where kind != 'inbox_poll' order by created_at",
  );

export const requestRows = (world) => sqlRows(world, "select id, status, last_error from requests");

export async function mailboxError(world) {
  const [row] = await sqlRows(world, "select last_error, last_send_error from mailboxes");
  return row?.last_send_error ?? row?.last_error ?? null;
}

export const isoAgo = (ms) => new Date(Date.now() - ms).toISOString();

/** What the person, or the operator, would learn without opening a log. */
async function seenByPerson(world) {
  const board = await dashboard(world.instance, world.profileId);
  return (
    Boolean(board?.mailbox?.lastError) ||
    (board?.attention?.failedTasks ?? 0) > 0 ||
    world.push.received.length > 0
  );
}

/** What was already visible earlier counts, as a later poll may clear a mailbox error that was shown. */
export async function told(world) {
  if (world.seenEarlier) return true;
  return Boolean(await until(() => seenByPerson(world), TELL_WINDOW_MS, 2_000));
}

/** Every Message-ID the server kept must have been kept once and be recorded as sent. */
export async function deliveryAccounting(world) {
  const rows = await sqlRows(world, "select message_id from outgoing_mail");
  const recorded = new Set(rows.map((row) => row.message_id));
  const counts = new Map();
  for (const { id } of world.fake.delivered) counts.set(id, (counts.get(id) ?? 0) + 1);
  const duplicated = [...counts].filter(([, n]) => n > 1).map(([id]) => id);
  const unrecorded = [...counts.keys()].filter((id) => !recorded.has(id));
  const undelivered = [...recorded].filter((id) => !counts.has(id));
  if (duplicated.length) world.notes.push(`delivered more than once: ${duplicated.length}`);
  if (unrecorded.length) world.notes.push(`delivered but not recorded: ${unrecorded.length}`);
  if (undelivered.length) world.notes.push(`recorded but never delivered: ${undelivered.length}`);
  return duplicated.length === 0 && unrecorded.length === 0 && undelivered.length === 0;
}

/** A request waiting to be sent needs a task that will send it. */
export async function noOrphanedRequest(world) {
  const orphans = await sqlRows(
    world,
    `select r.id from requests r where r.status = 'queued' and not exists
       (select 1 from tasks t where t.request_id = r.id and t.status in ('queued', 'leased', 'blocked'))`,
  );
  if (orphans.length) world.notes.push(`queued requests with no live task: ${orphans.length}`);
  return orphans.length === 0;
}

export async function schedulerFresh(world) {
  const result = await world.instance.api.try(API_ROUTES.status);
  const lastPassAt = result.body?.health?.scheduler?.lastPassAt;
  if (!lastPassAt) {
    world.notes.push(`scheduler has no completed pass (status ${result.status})`);
    return false;
  }
  const age = Date.now() - Date.parse(lastPassAt);
  if (age >= SCHEDULER_MAX_AGE_MS)
    world.notes.push(`scheduler last pass ${Math.round(age / 1000)}s old`);
  return age < SCHEDULER_MAX_AGE_MS;
}

/** Asks for a poll the way the Check now button does, and waits for the mail server to be dialed. */
export async function pollStarts(world) {
  const before = world.fake.imapConnections.length;
  await world.instance.api.try(API_ROUTES.mailboxPoll, { params: { id: world.profileId } });
  const started = await until(
    () => world.fake.imapConnections.length > before,
    POLL_START_WINDOW_MS,
    250,
  );
  if (!started)
    world.notes.push(`a requested poll did not start within ${POLL_START_WINDOW_MS / 1000}s`);
  return Boolean(started);
}

/** The two liveness checks that must hold while the fault is still in effect. */
export async function duringFault(world) {
  world.seenEarlier ||= await seenByPerson(world);
  world.mailboxErrorAtPeak = await mailboxError(world);
  return { scheduler: await schedulerFresh(world), poll: await pollStarts(world) };
}

export async function fastForwardLeases(world) {
  await sqlRows(world, "update tasks set lease_expires_at = ? where status = 'leased'", [
    isoAgo(MINUTE),
  ]);
}

export async function fastForwardBackoff(world) {
  await sqlRows(
    world,
    "update tasks set run_after = ? where status = 'queued' and run_after is not null",
    [isoAgo(MINUTE)],
  );
  // A site is also visited at most so often, and the minutes that spacing takes are not what is under test.
  await sqlRows(world, "delete from site_visits");
  await sqlRows(world, "update site_state set next_start_after = null, cooling_down_until = null");
}

/** A crash or kill leaves a lease behind. This waits out the lease and the grace the way a day would. */
export async function waitOutLapsedLease(world, seconds = 40) {
  await fastForwardLeases(world);
  await sleep(12_000);
  await fastForwardBackoff(world);
  await sleep((seconds - 12) * 1000);
}

export function verdict(world, checks) {
  return { name: world.name, checks, notes: world.notes };
}

export { sleep };
