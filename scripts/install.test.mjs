import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";

const root = resolve(import.meta.dirname, "..");

describe("docker-compose.yml", () => {
  const compose = readFileSync(join(root, "docker-compose.yml"), "utf8");

  it("names no fixed image, so a checkout only ever removes its own", () => {
    assert.doesNotMatch(compose, /^\s+image:\s*kickrocks\//m);
  });

  it("gives the server the same shutdown grace as the workers", () => {
    const server = compose.slice(compose.indexOf("\n  server:"), compose.indexOf("\n  worker:"));
    assert.match(server, /stop_grace_period: 30s/);
  });

  it("passes the mail test settings to the server", () => {
    assert.match(compose, /KICKROCKS_PLAINTEXT_MAIL_HOSTS: \$\{KICKROCKS_PLAINTEXT_MAIL_HOSTS:-\}/);
    assert.match(compose, /KICKROCKS_SEND_GAP_MS: \$\{KICKROCKS_SEND_GAP_MS:-\}/);
  });
});

// A docker that records what it was asked and fakes just enough of it for install.sh to run.
const FAKE_DOCKER = `#!/usr/bin/env bash
echo "$*" >> "$FAKE_LOG"
case "$1 $2" in
  "compose version") exit 0 ;;
  "compose config") echo "name: scratch"; exit 0 ;;
  "volume inspect") exit 0 ;;
  "image inspect") [ -z "$FAKE_NO_IMAGE" ] || exit 1; exit 0 ;;
  "compose build") [ "$FAKE_BUILD" != fail ] || exit 1; exit 0 ;;
esac
case "$*" in
  *"ps -a -q"*) [ -n "$FAKE_NO_CONTAINERS" ] || echo abc123 ;;
  *"ps --services"*) if [ -n "$FAKE_STOPPED" ]; then echo; elif [ -z "$FAKE_NO_CONTAINERS" ]; then echo server; fi ;;
  "compose run"*) case "$FAKE_OPENS" in fail) exit 3 ;; broken) exit 1 ;; esac ;;
  *"compose "*" stop"*) [ -z "$FAKE_NO_CONTAINERS" ] || { echo 'no container found for project "scratch": not found' >&2; exit 1; } ;;
  *"-previous-"*":/from:ro"*) [ "$FAKE_ROLLBACK" != fail ] || exit 1 ;;
  *"-restore-"*":/from:ro"*)
    [ "$FAKE_SWAP" != interrupt ] || { kill -TERM "$PPID"; sleep 1; }
    [ "$FAKE_SWAP" != fail ] || exit 1 ;;
  *"-v scratch_kickrocks-data:/from:ro"*) [ "$FAKE_ASIDE" != fail ] || exit 1 ;;
  "run --rm -v scratch_kickrocks-data:/data:ro alpine tar czf"*)
    case "$FAKE_TAR" in
      ok) cat "$FAKE_ARCHIVE" ;;
      truncated) head -c 40 "$FAKE_ARCHIVE" ;;
      fail) head -c 40 "$FAKE_ARCHIVE"; exit 3 ;;
    esac ;;
  "run --rm -i"*) cat >/dev/null ;;
esac
exit 0
`;

describe("install.sh backup and restore", () => {
  let dir;
  let archive;
  const install = (args, options = {}) =>
    spawnSync("bash", [join(root, "install.sh"), ...args], {
      cwd: dir,
      encoding: "utf8",
      input: options.input,
      env: {
        ...process.env,
        PATH: `${join(dir, "bin")}:${process.env.PATH}`,
        FAKE_LOG: join(dir, "calls.log"),
        FAKE_ARCHIVE: archive,
        HOME: dir,
        ...options.env,
      },
    });
  const calls = () =>
    existsSync(join(dir, "calls.log")) ? readFileSync(join(dir, "calls.log"), "utf8") : "";

  before(() => {
    dir = mkdtempSync(join(tmpdir(), "kr-install-"));
    mkdirSync(join(dir, "bin"));
    writeFileSync(join(dir, "bin", "docker"), FAKE_DOCKER);
    chmodSync(join(dir, "bin", "docker"), 0o755);
    const data = join(dir, "data");
    mkdirSync(data);
    writeFileSync(join(data, "kickrocks.db"), "x".repeat(200_000));
    writeFileSync(join(data, "db.key"), "key");
    archive = join(dir, "good.tgz");
    execFileSync("tar", ["czf", archive, "-C", data, "."]);
  });
  beforeEach(() => rmSync(join(dir, "calls.log"), { force: true }));
  after(() => rmSync(dir, { recursive: true, force: true }));

  it("keeps the previous backup when tar fails partway", () => {
    const target = join(dir, "kept.tgz");
    writeFileSync(target, "previous good backup");
    const result = install(["--backup", target], { env: { FAKE_TAR: "fail" } });
    assert.notEqual(result.status, 0);
    assert.equal(readFileSync(target, "utf8"), "previous good backup");
    assert.equal(existsSync(`${target}.partial`), false);
  });

  it("refuses a backup that does not read back whole", () => {
    const target = join(dir, "short.tgz");
    const result = install(["--backup", target], { env: { FAKE_TAR: "truncated" } });
    assert.notEqual(result.status, 0);
    assert.equal(existsSync(target), false);
  });

  it("writes a backup that reads back whole", () => {
    const target = join(dir, "whole.tgz");
    const result = install(["--backup", target], { env: { FAKE_TAR: "ok" } });
    assert.equal(result.status, 0, result.stderr);
    execFileSync("tar", ["tzf", target]);
  });

  it("tells the app about a backup that read back whole, and about no other", () => {
    install(["--backup", join(dir, "short2.tgz")], { env: { FAKE_TAR: "truncated" } });
    assert.doesNotMatch(calls(), /last-backup/);
    install(["--backup", join(dir, "whole2.tgz")], { env: { FAKE_TAR: "ok" } });
    assert.match(calls(), /VERIFIED_AT=\d{4}-\d\d-\d\dT[\d:]+Z .*\/data\/last-backup/);
  });

  it("keeps the newest N scheduled backups and deletes older ones only after a good run", () => {
    const folder = join(dir, "scheduled");
    const written = [];
    for (let i = 0; i < 4; i++) {
      const result = install(["--schedule-backup", folder, "--once", "--keep", "2"], {
        env: { FAKE_TAR: "ok" },
      });
      assert.equal(result.status, 0, result.stderr);
      written.push(result.stdout.match(/Wrote (\S+)/)[1]);
    }
    const names = readdirSync(folder).sort();
    assert.deepEqual(
      names,
      written
        .slice(2)
        .map((path) => path.split("/").pop())
        .sort(),
    );
    for (const name of names) execFileSync("tar", ["tzf", join(folder, name)]);
    const failed = install(["--schedule-backup", folder, "--once", "--keep", "1"], {
      env: { FAKE_TAR: "truncated" },
    });
    assert.notEqual(failed.status, 0);
    assert.deepEqual(readdirSync(folder).sort(), names);
  });

  it("keeps the newest scheduled backup with --keep 1 when runs share a second", () => {
    const folder = join(dir, "scheduled-one");
    let last;
    for (let i = 0; i < 12; i++) {
      const result = install(["--schedule-backup", folder, "--once", "--keep", "1"], {
        env: { FAKE_TAR: "ok", PATH: `${join(dir, "bin")}:${process.env.PATH}` },
      });
      assert.equal(result.status, 0, result.stderr);
      last = result.stdout.match(/Wrote (\S+)/)[1];
    }
    assert.deepEqual(readdirSync(folder), [last.split("/").pop()]);
  });

  it("never rotates away a manual backup kept in the same folder", () => {
    const folder = join(dir, "mixed");
    mkdirSync(folder);
    const manual = join(folder, "kickrocks-backup-20200101-000000.tgz");
    writeFileSync(manual, "pre-upgrade backup");
    for (let i = 0; i < 3; i++) {
      install(["--schedule-backup", folder, "--once", "--keep", "1"], { env: { FAKE_TAR: "ok" } });
    }
    assert.equal(readFileSync(manual, "utf8"), "pre-upgrade backup");
    assert.equal(readdirSync(folder).filter((n) => n.startsWith("kickrocks-scheduled-")).length, 1);
  });

  it("prints a crontab line without running a backup when --once is absent", () => {
    const result = install(["--schedule-backup", join(dir, "nightly"), "--keep", "5"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /30 3 \* \* \* .*--schedule-backup .*--once --keep 5/);
    assert.doesNotMatch(calls(), /tar czf/);
  });

  it("puts PATH, DOCKER_HOST, quoting and a log into the crontab line", () => {
    const folder = join(dir, "with space");
    const result = install(["--schedule-backup", folder], {
      env: {
        PATH: `/opt/odd bin:${join(dir, "bin")}:${process.env.PATH}`,
        DOCKER_HOST: "unix:///run/user/1000/docker.sock",
      },
    });
    assert.equal(result.status, 0, result.stderr);
    const line = result.stdout.split("\n").find((l) => l.startsWith("30 3"));
    assert.match(line, /^30 3 \* \* \* PATH='\/opt\/odd bin:/);
    assert.match(line, / DOCKER_HOST='unix:\/\/\/run\/user\/1000\/docker.sock' /);
    assert.match(line, / '[^']*\/install\.sh' --schedule-backup '[^']*with space' /);
    assert.match(line, / >> '[^']*with space\/schedule\.log' 2>&1$/);
    assert.equal(existsSync(folder), true);
  });

  it("refuses a crontab line that would hold a percent sign", () => {
    const result = install(["--schedule-backup", join(dir, "50%off")]);
    assert.equal(result.status, 2);
    assert.doesNotMatch(result.stdout, /30 3/);
  });

  it("refuses to restore a truncated archive before touching any volume", () => {
    const cut = join(dir, "cut.tgz");
    writeFileSync(cut, readFileSync(archive).subarray(0, 40));
    const result = install(["--restore", cut], { input: "restore\n" });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /not a complete/);
    assert.doesNotMatch(calls(), /volume create|compose .*stop/);
  });

  it("refuses an archive without the database key", () => {
    const folder = join(dir, "other");
    mkdirSync(folder);
    writeFileSync(join(folder, "other.txt"), "x");
    const other = join(dir, "other.tgz");
    execFileSync("tar", ["czf", other, "-C", folder, "."]);
    const result = install(["--restore", other], { input: "restore\n" });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /not a complete/);
  });

  it("refuses an archive whose database does not open, before touching the live volume", () => {
    const result = install(["--restore", archive], {
      input: "restore\n",
      env: { FAKE_OPENS: "fail" },
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /does not open with the key/);
    assert.doesNotMatch(calls(), /-v scratch_kickrocks-data:\/to/);
  });

  it("checks the database from a read-only mount so the volume gets no side files", () => {
    const result = install(["--restore", archive], { input: "restore\n" });
    assert.equal(result.status, 0, result.stderr);
    assert.match(calls(), /compose run .* -v scratch_kickrocks-data-restore-\d+:\/check:ro /);
  });

  it("builds the server image in view when the machine has none", () => {
    const result = install(["--restore", archive], {
      input: "restore\n",
      env: { FAKE_NO_IMAGE: "1" },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Building the server image/);
    assert.match(calls(), /compose build server/);
  });

  it("does not build the server image when it is there", () => {
    install(["--restore", archive], { input: "restore\n" });
    assert.doesNotMatch(calls(), /compose build/);
  });

  it("blames the build, not the backup, when the image cannot be built", () => {
    const result = install(["--restore", archive], {
      input: "restore\n",
      env: { FAKE_NO_IMAGE: "1", FAKE_BUILD: "fail" },
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Could not build the server image/);
    assert.doesNotMatch(result.stderr, /does not open with the key/);
  });

  it("blames the check, not the backup, when compose fails to run it", () => {
    const result = install(["--restore", archive], {
      input: "restore\n",
      env: { FAKE_OPENS: "broken" },
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /could not run/);
    assert.doesNotMatch(result.stderr, /does not open with the key/);
    assert.doesNotMatch(calls(), /-v scratch_kickrocks-data:\/to/);
  });

  it("backs up a stack that is stopped without trying to start a service named nothing", () => {
    const target = join(dir, "stopped.tgz");
    const result = install(["--backup", target], { env: { FAKE_TAR: "ok", FAKE_STOPPED: "1" } });
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stderr, /no such service/);
    assert.doesNotMatch(calls(), /compose .* start/);
  });

  describe("with a passphrase", () => {
    let passphrase;
    let wrong;
    before(() => {
      passphrase = join(dir, "pass.txt");
      wrong = join(dir, "wrong.txt");
      writeFileSync(passphrase, "correct passphrase\n", { mode: 0o600 });
      writeFileSync(wrong, "another passphrase\n", { mode: 0o600 });
    });

    it("writes an archive tar cannot read, and restores it with the passphrase", () => {
      const target = join(dir, "sealed.bin");
      const made = install(["--backup", target, "--passphrase-file", passphrase], {
        env: { FAKE_TAR: "ok" },
      });
      assert.equal(made.status, 0, made.stderr);
      assert.throws(() => execFileSync("tar", ["tzf", target], { stdio: "ignore" }));
      const restored = install(["--restore", target, "--passphrase-file", passphrase], {
        input: "restore\n",
      });
      assert.equal(restored.status, 0, restored.stderr);
    });

    it("refuses the wrong passphrase, and an encrypted archive given none", () => {
      const target = join(dir, "sealed2.bin");
      install(["--backup", target, "--passphrase-file", passphrase], { env: { FAKE_TAR: "ok" } });
      const mistaken = install(["--restore", target, "--passphrase-file", wrong], {
        input: "restore\n",
      });
      assert.equal(mistaken.status, 1);
      assert.doesNotMatch(calls(), /volume create/);
      const bare = install(["--restore", target], { input: "restore\n" });
      assert.equal(bare.status, 1);
      assert.match(bare.stderr, /is encrypted/);
    });
  });

  it("changes nothing unless the person types restore", () => {
    const result = install(["--restore", archive], { input: "no\n" });
    assert.notEqual(result.status, 0);
    assert.doesNotMatch(calls(), /volume create scratch_kickrocks-data-restore/);
  });

  it("carries the live last-backup marker over a restore instead of the archive's", () => {
    const result = install(["--restore", archive], { input: "restore\n" });
    assert.equal(result.status, 0, result.stderr);
    const log = calls();
    assert.match(
      log,
      /-v scratch_kickrocks-data-previous-\d+:\/live:ro -v scratch_kickrocks-data:\/to alpine sh -c if \[ -f \/live\/last-backup \]/,
    );
    assert.ok(
      log.search(/\/live\/last-backup/) > log.search(/-restore-\d+:\/from:ro/),
      "the marker is put back after the swap",
    );
    assert.ok(
      log.search(/\/live\/last-backup/) <
        log.search(/volume rm -f scratch_kickrocks-data-previous/),
      "and before the old copy is deleted",
    );
  });

  it("restores through a scratch volume and swaps it in", () => {
    const result = install(["--restore", archive], { input: "restore\n" });
    assert.equal(result.status, 0, result.stderr);
    const log = calls();
    assert.match(log, /volume create scratch_kickrocks-data-restore-\d+/);
    assert.match(
      log,
      /-v scratch_kickrocks-data-restore-\d+:\/from:ro -v scratch_kickrocks-data:\/to/,
    );
    assert.match(log, /volume rm -f scratch_kickrocks-data-restore-\d+/);
  });

  it("puts the previous data back and removes its copy when the swap fails", () => {
    const result = install(["--restore", archive], {
      input: "restore\n",
      env: { FAKE_SWAP: "fail" },
    });
    assert.equal(result.status, 1);
    const log = calls();
    assert.match(
      log,
      /-v scratch_kickrocks-data-previous-\d+:\/from:ro -v scratch_kickrocks-data:\/to/,
    );
    assert.match(log, /volume rm -f scratch_kickrocks-data-previous-\d+/);
    assert.match(log, /compose .*start server/);
  });

  it("keeps the previous data and starts nothing when the rollback fails too", () => {
    const result = install(["--restore", archive], {
      input: "restore\n",
      env: { FAKE_SWAP: "fail", FAKE_ROLLBACK: "fail" },
    });
    assert.equal(result.status, 1);
    const log = calls();
    assert.match(
      log,
      /-v scratch_kickrocks-data-previous-\d+:\/from:ro -v scratch_kickrocks-data:\/to/,
    );
    assert.doesNotMatch(log, /volume rm [^\n]*-previous-/);
    assert.doesNotMatch(log, /compose .* start/);
    const name = result.stderr.match(/volume (scratch_kickrocks-data-previous-\d+)\./)?.[1];
    assert.ok(name, result.stderr);
    assert.match(
      result.stderr,
      new RegExp(`docker run --rm -v ${name}:/from:ro -v scratch_kickrocks-data:/to`),
    );
  });

  it("starts nothing and says where the old data is when interrupted during the swap", () => {
    const result = install(["--restore", archive], {
      input: "restore\n",
      env: { FAKE_SWAP: "interrupt" },
    });
    assert.equal(result.signal, "SIGTERM");
    assert.doesNotMatch(calls(), /compose .* start/);
    const name = result.stderr.match(/volume (scratch_kickrocks-data-previous-\d+)\./)?.[1];
    assert.ok(name, result.stderr);
    assert.match(result.stderr, new RegExp(`-v ${name}:/from:ro -v scratch_kickrocks-data:/to`));
    assert.doesNotMatch(calls(), /volume rm [^\n]*-previous-/);
  });

  it("explains a full disk when the current data cannot be copied aside", () => {
    const result = install(["--restore", archive], {
      input: "restore\n",
      env: { FAKE_ASIDE: "fail" },
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /three times/);
    assert.doesNotMatch(calls(), /-restore-\d+:\/from:ro -v scratch_kickrocks-data:\/to/);
  });

  it("prints no error on a new machine with no containers", () => {
    const result = install(["--restore", archive], {
      input: "restore\n",
      env: { FAKE_NO_CONTAINERS: "1" },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stderr, /no container found/);
    assert.match(result.stdout, /Restored scratch_kickrocks-data/);
  });
});
