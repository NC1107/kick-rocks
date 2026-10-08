import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
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
esac
case "$*" in
  *"ps -a -q"*) [ -n "$FAKE_NO_CONTAINERS" ] || echo abc123 ;;
  *"ps --services"*) [ -n "$FAKE_NO_CONTAINERS" ] || echo server ;;
  *"compose "*" stop"*) [ -z "$FAKE_NO_CONTAINERS" ] || { echo 'no container found for project "scratch": not found' >&2; exit 1; } ;;
  *"-previous-"*":/from:ro"*) [ "$FAKE_ROLLBACK" != fail ] || exit 1 ;;
  *"-restore-"*":/from:ro"*) [ "$FAKE_SWAP" != fail ] || exit 1 ;;
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

  it("changes nothing unless the person types restore", () => {
    const result = install(["--restore", archive], { input: "no\n" });
    assert.notEqual(result.status, 0);
    assert.doesNotMatch(calls(), /volume create scratch_kickrocks-data-restore/);
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
