import { spawnSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  rmSync,
  statSync,
  truncateSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { compareSnapshots, readDatabase } from "./ladder.mjs";

const root = resolve(import.meta.dirname, "..", "..", "..");
const PASSWORD = "correct horse battery staple";
const IDENTITIES = [
  {
    kind: "name",
    value: { first: "Jordan", last: "Example" },
    isPrimary: true,
    validFrom: null,
    validTo: null,
  },
  {
    kind: "email",
    value: { address: "jordan.example@example.com" },
    isPrimary: true,
    validFrom: null,
    validTo: null,
  },
  {
    kind: "phone",
    value: { number: "+15125550142" },
    isPrimary: true,
    validFrom: null,
    validTo: null,
  },
  {
    kind: "address",
    value: { street: "100 Example Street", city: "Austin", state: "TX", zip: "78701" },
    isPrimary: true,
    validFrom: null,
    validTo: null,
  },
];

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    ...options,
  });
  return { code: result.status ?? 1, out: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}

async function freePort() {
  return new Promise((resolvePort, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolvePort(port));
    });
  });
}

// Compose reads the tracked files plus new ones, so the drill tests the checkout as it stands, and its .env and
// backups stay out of the worktree.
function copyCheckout(destination) {
  const files = run("git", ["ls-files", "-co", "--exclude-standard", "-z"], {
    cwd: root,
  }).out.split("\0");
  for (const file of files.filter(Boolean)) {
    const from = join(root, file);
    if (!existsSync(from)) continue;
    mkdirSync(dirname(join(destination, file)), { recursive: true });
    cpSync(from, join(destination, file));
  }
}

class Instance {
  constructor(name, port, checkout, home, extraPath) {
    this.project = name;
    this.port = port;
    this.checkout = checkout;
    this.env = {
      ...process.env,
      COMPOSE_PROJECT_NAME: name,
      COMPOSE_PROFILES: "",
      KICKROCKS_HOST_PORT: String(port),
      KICKROCKS_BIND_ADDRESS: "127.0.0.1",
      KICKROCKS_WORKER_TOKEN: "",
      HOME: home,
      PATH: extraPath ? `${extraPath}:${process.env.PATH}` : process.env.PATH,
    };
    this.volume = `${name}_kickrocks-data`;
  }

  compose(...args) {
    return run("docker", ["compose", ...args], { cwd: this.checkout, env: this.env });
  }

  install(args, { input, path } = {}) {
    const env = path ? { ...this.env, PATH: `${path}:${this.env.PATH}` } : this.env;
    return run("bash", [join(this.checkout, "install.sh"), ...args], {
      cwd: this.checkout,
      env,
      input,
    });
  }

  up() {
    return this.compose("up", "-d", "--build", "--wait", "--wait-timeout", "240", "server");
  }

  async call(method, path, body, cookie) {
    const headers = { "x-kick-rocks": "1" };
    if (cookie) headers.cookie = cookie;
    if (body !== undefined) headers["content-type"] = "application/json";
    const response = await fetch(`http://127.0.0.1:${this.port}/api${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    const setCookie = response.headers
      .getSetCookie()
      .find((value) => value.startsWith("kr_session="));
    return {
      ok: response.ok,
      status: response.status,
      body: text.startsWith("{") || text.startsWith("[") ? JSON.parse(text) : text,
      cookie: setCookie?.split(";")[0],
    };
  }

  volumeDigest() {
    return run("docker", [
      "run",
      "--rm",
      "-v",
      `${this.volume}:/data:ro`,
      "alpine",
      "sh",
      "-c",
      "cd /data && find . -type f -exec sha256sum {} + | sort",
    ]).out;
  }

  // Read straight from the volume rather than through install.sh, so the tool under test is not its own witness.
  copyVolume(into) {
    mkdirSync(into, { recursive: true, mode: 0o700 });
    const tarFile = `${into}.tar`;
    const fd = openSync(tarFile, "w", 0o600);
    spawnSync(
      "docker",
      [
        "run",
        "--rm",
        "-v",
        `${this.volume}:/data:ro`,
        "alpine",
        "tar",
        "cf",
        "-",
        "-C",
        "/data",
        ".",
      ],
      {
        stdio: ["ignore", fd, "inherit"],
      },
    );
    run("tar", ["--no-same-owner", "-xf", tarFile, "-C", into]);
    rmSync(tarFile, { force: true });
    return into;
  }

  teardown() {
    this.compose("down", "--volumes", "--rmi", "local", "--remove-orphans", "--timeout", "5");
    const leftovers = run("docker", ["volume", "ls", "-q", "--filter", `name=${this.project}`])
      .out.split("\n")
      .filter(Boolean);
    if (leftovers.length > 0) run("docker", ["volume", "rm", "-f", ...leftovers]);
  }
}

function archiveWith(scratch, name, sourceDir, mutate) {
  const staging = join(scratch, `stage-${name}`);
  cpSync(sourceDir, staging, { recursive: true });
  mutate(staging);
  const file = join(scratch, "archives", `${name}.tgz`);
  run("tar", ["czf", file, "-C", staging, "."]);
  chmodSync(file, 0o600);
  return file;
}

function rowsDiffer(before, after) {
  const forward = compareSnapshots(before, after);
  const backward = compareSnapshots(after, before);
  return forward.mismatched + backward.mismatched + Object.keys(forward.rowCountDiff).length;
}

export async function runDrill() {
  const failing = [];
  const metrics = {};
  const fail = (item) => failing.push(item);

  const scratch = mkdtempSync(join(tmpdir(), "loop-backup-drill-"));
  chmodSync(scratch, 0o700);
  const checkout = join(scratch, "checkout");
  const home = join(scratch, "home");
  const archives = join(scratch, "archives");
  for (const dir of [checkout, home, archives]) mkdirSync(dir, { mode: 0o700 });

  const suffix = Math.random().toString(36).slice(2, 8);
  const shimDir = join(scratch, "shim");
  mkdirSync(shimDir);
  const realDocker = run("sh", ["-c", "command -v docker"]).out.trim();
  writeFileSync(
    join(shimDir, "docker"),
    `#!/usr/bin/env bash\ncase "$*" in\n  *"tar czf"*) head -c 40 /dev/urandom; exit 3 ;;\nesac\nexec "${realDocker}" "$@"\n`,
    { mode: 0o755 },
  );

  const source = new Instance(`loop-backup-drill-a-${suffix}`, await freePort(), checkout, home);
  const target = new Instance(`loop-backup-drill-b-${suffix}`, await freePort(), checkout, home);

  try {
    copyCheckout(checkout);
    const started = source.up();
    if (started.code !== 0) {
      fail("the stack does not build and start");
      metrics.startError = started.out.slice(-600);
      return { metrics, failing };
    }

    const setup = await source.call("POST", "/auth/setup", { password: PASSWORD });
    const created = await source.call(
      "POST",
      "/profiles",
      { displayName: "Jordan Example", state: "TX", identities: IDENTITIES },
      setup.cookie,
    );
    if (!setup.ok || !created.ok) {
      fail("the drill could not seed the source instance");
      metrics.seedError = `${setup.status} ${created.status}`;
      return { metrics, failing };
    }

    const good = join(archives, "good.tgz");
    const backup = source.install(["--backup", good]);
    metrics.backupExit = backup.code;
    if (backup.code !== 0 || !existsSync(good)) {
      fail("backup does not write an archive");
      return { metrics, failing };
    }
    if ((statSync(good).mode & 0o077) !== 0) fail("backup archive is readable by others");
    const listing = run("tar", ["tzf", good]).out;
    if (!/\.\/kickrocks\.db/.test(listing) || !/\.\/db\.key/.test(listing))
      fail("backup archive lacks the database or key");

    source.compose("stop", "server");
    const sourceData = source.copyVolume(join(scratch, "data-source"));
    const sourceRows = readDatabase(sourceData);
    metrics.tables = Object.keys(sourceRows).length;
    metrics.sourceRows = Object.values(sourceRows).reduce(
      (sum, table) => sum + table.rows.length,
      0,
    );

    const restoreStart = Date.now();
    const restored = target.install(["--restore", good], { input: "restore\n" });
    if (restored.code !== 0) {
      fail("restore of a good archive into a fresh project fails");
      metrics.restoreError = restored.out.slice(-400);
      return { metrics, failing };
    }
    const targetData = target.copyVolume(join(scratch, "data-target"));
    const rowDiff = rowsDiffer(sourceRows, readDatabase(targetData));
    metrics.rowDiffAfterRestore = rowDiff;
    if (rowDiff !== 0) fail(`row diff after restore is ${rowDiff}`);

    const healthy = target.up();
    metrics.secondsToHealthyRestore = Math.round((Date.now() - restoreStart) / 100) / 10;
    if (healthy.code !== 0) fail("the restored instance does not become healthy");
    const login = await target.call("POST", "/auth/login", { password: PASSWORD });
    metrics.restoredLogin = { status: login.status, profiles: null };
    const profiles = login.ok
      ? await target.call("GET", "/profiles", undefined, login.cookie)
      : null;
    if (!login.ok || profiles?.body?.profiles?.length !== 1) {
      fail("the restored instance does not accept the password or lost the profile");
    }
    const status = login.ok ? await target.call("GET", "/status", undefined, login.cookie) : null;
    if (status?.body?.health?.backup === undefined) fail("the app shows no backup freshness");
    target.compose("stop", "server");

    const stoppedBackup = target.install(["--backup", join(archives, "stopped.tgz")]);
    metrics.backupOfStoppedStack = {
      exit: stoppedBackup.code,
      output: stoppedBackup.out.slice(-200),
    };
    if (stoppedBackup.code !== 0) fail("a backup of a stopped stack exits with an error");

    // A bad archive must leave the data volume exactly as it was.
    const untouchedAfter = (name, file, options) => {
      const before = target.volumeDigest();
      const result = target.install(["--restore", file, ...(options ?? [])], {
        input: "restore\n",
      });
      const same = before === target.volumeDigest();
      if (result.code === 0 || !same) fail(name);
      if (!same) target.install(["--restore", good], { input: "restore\n" });
      return { exit: result.code, untouched: same, output: result.out.slice(-300) };
    };

    const truncated = join(archives, "truncated.tgz");
    run("cp", [good, truncated]);
    truncateSync(truncated, Math.floor(statSync(good).size / 2));
    chmodSync(truncated, 0o600);
    metrics.truncatedArchive = untouchedAfter(
      "a truncated archive is not refused cleanly",
      truncated,
    );

    const wrongKey = archiveWith(scratch, "wrong-key", sourceData, (dir) =>
      writeFileSync(join(dir, "db.key"), `${"ab".repeat(32)}\n`, { mode: 0o600 }),
    );
    metrics.wrongKeyArchive = untouchedAfter(
      "an archive whose key does not open its database is not refused",
      wrongKey,
    );

    const garbage = archiveWith(scratch, "garbage-db", sourceData, (dir) =>
      writeFileSync(
        join(dir, "kickrocks.db"),
        Buffer.alloc(statSync(join(dir, "kickrocks.db")).size, 7),
      ),
    );
    metrics.garbageDatabaseArchive = untouchedAfter(
      "an archive with a damaged database is not refused",
      garbage,
    );

    const keep = join(archives, "keep.tgz");
    run("cp", [good, keep]);
    const keepDigest = run("sha256sum", [keep]).out;
    const failedBackup = source.install(["--backup", keep], { path: shimDir });
    const keepSurvived =
      failedBackup.code !== 0 &&
      run("sha256sum", [keep]).out === keepDigest &&
      !existsSync(`${keep}.partial`);
    metrics.failedBackupOverwrite = { exit: failedBackup.code, goodArchiveKept: keepSurvived };
    if (!keepSurvived) fail("a failed backup replaces or litters the existing good archive");

    const passFile = join(scratch, "pass.txt");
    const wrongPassFile = join(scratch, "wrong-pass.txt");
    writeFileSync(passFile, "a long passphrase for the drill\n", { mode: 0o600 });
    writeFileSync(wrongPassFile, "not the passphrase\n", { mode: 0o600 });
    const encrypted = join(archives, "encrypted.bin");
    const encBackup = source.install(["--backup", encrypted, "--passphrase-file", passFile]);
    const isEncrypted =
      encBackup.code === 0 && existsSync(encrypted) && run("tar", ["tzf", encrypted]).code !== 0;
    metrics.passphraseBackup = { exit: encBackup.code, encrypted: isEncrypted };
    if (!isEncrypted) {
      fail("a passphrase backup is not encrypted");
      fail("a passphrase archive does not restore with its passphrase");
      fail("a passphrase archive restores with the wrong passphrase");
    } else {
      const roundTrip = target.install(["--restore", encrypted, "--passphrase-file", passFile], {
        input: "restore\n",
      });
      const back =
        roundTrip.code === 0
          ? rowsDiffer(sourceRows, readDatabase(target.copyVolume(join(scratch, "data-enc"))))
          : -1;
      if (back !== 0) fail("a passphrase archive does not restore with its passphrase");
      const before = target.volumeDigest();
      const wrong = target.install(["--restore", encrypted, "--passphrase-file", wrongPassFile], {
        input: "restore\n",
      });
      if (wrong.code === 0 || before !== target.volumeDigest())
        fail("a passphrase archive restores with the wrong passphrase");
    }

    const scheduleDir = join(archives, "scheduled");
    const scheduled = source.install(["--schedule-backup", scheduleDir, "--once", "--keep", "2"]);
    const scheduledFiles = existsSync(scheduleDir)
      ? readdirSync(scheduleDir).filter((f) => !f.endsWith(".partial"))
      : [];
    const fresh = scheduledFiles.some(
      (f) => Date.now() - statSync(join(scheduleDir, f)).mtimeMs < 24 * 3600 * 1000,
    );
    metrics.scheduledBackup = { exit: scheduled.code, files: scheduledFiles.length, fresh };
    if (scheduled.code !== 0 || !fresh) fail("no scheduled verified backup under 24 hours old");
    else {
      for (let i = 0; i < 3; i++)
        source.install(["--schedule-backup", scheduleDir, "--once", "--keep", "2"]);
      const kept = readdirSync(scheduleDir).filter((f) => !f.endsWith(".partial")).length;
      metrics.scheduledBackup.filesAfterFourRuns = kept;
      if (kept > 2) fail("scheduled backups are not pruned by retention");
    }

    return { metrics, failing };
  } finally {
    source.teardown();
    target.teardown();
    rmSync(scratch, { recursive: true, force: true });
  }
}
