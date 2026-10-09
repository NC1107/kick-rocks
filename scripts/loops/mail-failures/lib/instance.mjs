// One Kick Rocks server under test: the built server on a scratch data directory, or the same
// build inside a container whose data directory is a size-limited tmpfs.
import { execFile, spawn } from "node:child_process";
import { closeSync, cpSync, mkdirSync, openSync, readFileSync, rmSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
export const ROOT = new URL("../../../../", import.meta.url).pathname;
const SQL_HELPER = "scripts/loops/mail-failures/lib/sql.mjs";
const SKEW_PRELOAD = "scripts/loops/mail-failures/lib/skew.cjs";
const IMAGE = "node:22-bookworm-slim";

export const WORKER_TOKEN = "loopmailworker-1234567890";
export const PASSWORD = "correct horse battery staple";
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const { API_ROUTES, buildRoutePath } = await import(
  pathToFileURL(`${ROOT}packages/shared/dist/index.js`).href
);

export { API_ROUTES };

export async function freePort() {
  const probe = net.createServer();
  await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const { port } = probe.address();
  await new Promise((resolve) => probe.close(() => resolve()));
  return port;
}

/** Polls until `check` returns something truthy, and returns it, or null at the deadline. */
export async function until(check, timeoutMs, stepMs = 500) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() >= end) return null;
    await sleep(stepMs);
  }
}

export class Api {
  cookie = "";
  constructor(port) {
    this.port = port;
  }

  async try(route, { params, query, body } = {}) {
    const headers = { "x-kick-rocks": "1" };
    if (this.cookie) headers.cookie = this.cookie;
    if (route.auth === "worker") headers.authorization = `Bearer ${WORKER_TOKEN}`;
    if (body !== undefined) headers["content-type"] = "application/json";
    const search = query
      ? `?${new URLSearchParams(Object.entries(query).map(([k, v]) => [k, String(v)]))}`
      : "";
    try {
      const response = await fetch(
        `http://127.0.0.1:${this.port}/api${buildRoutePath(route.path, params)}${search}`,
        {
          method: route.method,
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(15_000),
        },
      );
      const session = response.headers
        .getSetCookie()
        .find((value) => value.startsWith("kr_session="));
      if (session) this.cookie = session.split(";")[0];
      const text = await response.text();
      let json = text;
      try {
        json = JSON.parse(text);
      } catch {}
      return { ok: response.ok, status: response.status, body: json };
    } catch (error) {
      return { ok: false, status: 0, body: String(error.cause?.code ?? error.message) };
    }
  }

  async call(route, input) {
    const result = await this.try(route, input);
    if (!result.ok) {
      throw new Error(
        `${route.method} ${route.path} ${result.status} ${JSON.stringify(result.body)}`,
      );
    }
    return result.body;
  }
}

export class Instance {
  constructor({ workDir, name, container = false, tmpfsMegabytes = 100 }) {
    this.name = name;
    this.workDir = workDir;
    this.container = container;
    this.tmpfsMegabytes = tmpfsMegabytes;
    this.dataDir = container ? "/data" : join(workDir, `${name}-data`);
    this.logPath = join(workDir, `${name}.log`);
    this.containerName = `loop-mail-failures-${name}`;
    this.child = null;
    this.exitedAt = null;
    this.port = null;
    this.api = null;
  }

  env({ skewMs = 0, extra = {} } = {}) {
    const dataDir = this.dataDir;
    const root = this.container ? "/app/" : ROOT;
    return {
      KICKROCKS_DATA_DIR: dataDir,
      KICKROCKS_PORT: String(this.port),
      KICKROCKS_HOST: "127.0.0.1",
      KICKROCKS_WORKER_TOKEN: WORKER_TOKEN,
      KICKROCKS_EXTRA_TARGETS: `${root}e2e/fixtures/targets.json`,
      KICKROCKS_EXTRA_RECIPES: `${root}e2e/fixtures/recipes`,
      KICKROCKS_SEND_GAP_MS: "500-1000",
      LOG_LEVEL: "info",
      ...(skewMs
        ? { KR_SKEW_MS: String(skewMs), NODE_OPTIONS: `--require ${root}${SKEW_PRELOAD}` }
        : {}),
      ...extra,
    };
  }

  async start(options = {}) {
    this.port ??= await freePort();
    this.api = new Api(this.port);
    this.exitedAt = null;
    if (this.container) {
      const env = Object.entries(this.env(options)).flatMap(([key, value]) => [
        "-e",
        `${key}=${value}`,
      ]);
      await run("docker", [
        "run",
        "-d",
        "--name",
        this.containerName,
        "--network",
        "host",
        "--tmpfs",
        `/data:size=${this.tmpfsMegabytes}m`,
        "-v",
        `${ROOT}:/app:ro`,
        ...env,
        IMAGE,
        "node",
        "/app/apps/server/dist/main.js",
      ]);
    } else {
      mkdirSync(this.dataDir, { recursive: true });
      const log = openSync(this.logPath, "a");
      this.child = spawn("node", [`${ROOT}apps/server/dist/main.js`], {
        cwd: ROOT,
        stdio: ["ignore", log, log],
        env: { ...process.env, ...this.env(options) },
      });
      closeSync(log);
      this.child.on("exit", () => {
        this.exitedAt = Date.now();
      });
    }
    return Boolean(await until(() => this.healthy(), 30_000, 250));
  }

  async healthy() {
    return (await this.api.try(API_ROUTES.health)).ok;
  }

  /** Sends a signal and returns the milliseconds the process took to exit, or null if it never did. */
  async stop(signal = "SIGTERM", waitMs = 60_000) {
    if (!this.child) return null;
    const sentAt = Date.now();
    this.child.kill(signal);
    const gone = await until(() => this.exitedAt, waitMs, 100);
    this.child = null;
    return gone ? this.exitedAt - sentAt : null;
  }

  log() {
    if (this.container) return "";
    try {
      return readFileSync(this.logPath, "utf8");
    } catch {
      return "";
    }
  }

  async containerLogs() {
    const { stdout, stderr } = await run("docker", ["logs", this.containerName]).catch(() => ({
      stdout: "",
      stderr: "",
    }));
    return stdout + stderr;
  }

  async exec(command) {
    const { stdout } = await run("docker", ["exec", this.containerName, "sh", "-c", command]);
    return stdout;
  }

  /** Rows for a statement, or a changes summary for a write. */
  async sql(statement, params = []) {
    const args = [this.dataDir, statement, JSON.stringify(params)];
    const { stdout } = this.container
      ? await run("docker", ["exec", this.containerName, "node", `/app/${SQL_HELPER}`, ...args])
      : await run("node", [`${ROOT}${SQL_HELPER}`, ...args]);
    return JSON.parse(stdout);
  }

  async cleanup() {
    await this.stop("SIGKILL", 5_000).catch(() => undefined);
    if (this.container)
      await run("docker", ["rm", "-f", this.containerName]).catch(() => undefined);
    if (!this.container) rmSync(this.dataDir, { recursive: true, force: true });
  }

  /** A copy of the data directory, as install.sh --backup would archive it. The server must be stopped. */
  snapshot() {
    const copy = `${this.dataDir}-snapshot`;
    rmSync(copy, { recursive: true, force: true });
    cpSync(this.dataDir, copy, { recursive: true });
    return copy;
  }

  restore(snapshot) {
    rmSync(this.dataDir, { recursive: true, force: true });
    cpSync(snapshot, this.dataDir, { recursive: true });
  }
}

/** Collects the pushes the instance sends, standing in for an ntfy server. */
export async function startPushSink() {
  const received = [];
  const server = http.createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      received.push({ at: Date.now(), title: String(request.headers.title ?? ""), body });
      response.end("{}");
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    received,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

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
  { kind: "dob", value: { date: "1990-04-12" }, isPrimary: true, validFrom: null, validTo: null },
];

/** Sets the instance up as a person would: password, profile, mailbox, and a push channel. */
export async function bootstrap(instance, fake, { push = null, smtpPort = fake.smtpPort } = {}) {
  const api = instance.api;
  await api.call(API_ROUTES.authSetup, { body: { password: PASSWORD } });
  const profile = await api.call(API_ROUTES.profilesCreate, {
    body: { displayName: "Jordan Example", state: "TX", identities: IDENTITIES },
  });
  const connection = {
    provider: "other",
    address: "jordan.example@example.com",
    username: "jordan.example@example.com",
    password: "an-app-password",
    smtpHost: "127.0.0.1",
    smtpPort: fake.smtpPort,
    smtpSecure: false,
    imapHost: "127.0.0.1",
    imapPort: fake.imapPort,
  };
  const body = { ...connection, replyFolder: "INBOX", dailyCap: 50 };
  await api.call(API_ROUTES.mailboxSave, { params: { id: profile.id }, body });
  if (smtpPort !== fake.smtpPort) {
    await api.call(API_ROUTES.mailboxSave, {
      params: { id: profile.id },
      body: { ...body, smtpPort },
    });
  }
  if (push) {
    await api.call(API_ROUTES.notificationsPatch, {
      body: { ntfy: { serverUrl: push.url, topic: "loopmailfailures", token: null } },
    });
  }
  return { profileId: profile.id, mailboxBody: body };
}

export const startCampaign = (instance, profileId, targetIds) =>
  instance.api.call(API_ROUTES.campaignsCreate, {
    params: { id: profileId },
    body: { selection: { targetIds }, rights: ["opt_out"] },
  });

export const dashboard = async (instance, profileId) =>
  (await instance.api.try(API_ROUTES.dashboardGet, { params: { id: profileId } })).body;
