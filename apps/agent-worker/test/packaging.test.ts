import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { AGENT_ENV_KEYS, loadAgentWorkerConfig } from "../src/config.js";
import { loopTiming } from "../src/loop.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const read = (path: string): string => readFileSync(resolve(ROOT, path), "utf8");

const compose = read("docker-compose.yml");

function service(name: string): string {
  const start = compose.indexOf(`\n  ${name}:\n`);
  expect(start, `service ${name}`).toBeGreaterThan(-1);
  const rest = compose.slice(start + 1);
  const next = rest.slice(1).search(/\n {2}\S|\n\S/);
  return next === -1 ? rest : rest.slice(0, next + 1);
}

describe("the gate limits in the agent guide", () => {
  it("say that a page can split a value into pieces the gate does not put back together", () => {
    const guide = read("docs/agents.md");
    expect(guide).toContain("A page can send a value split into pieces");
    expect(guide).toContain("at least the first five characters of an email");
  });
});

describe("the agent worker's compose service", () => {
  const agent = service("agent-worker");

  it("starts only with the agent profile, so a plain `docker compose up` is unchanged", () => {
    expect(agent).toMatch(/profiles:\s*\n\s*- agent\b/);
    expect(service("server")).not.toContain("agent");
    expect(service("worker")).toMatch(/profiles:\s*\n\s*- worker\b/);
  });

  it("keeps its Chrome profile apart from the recipe worker's", () => {
    expect(agent).toContain("kickrocks-agent-chrome:/profile");
    expect(service("worker")).toContain("kickrocks-chrome:/profile");
  });

  it("drops capabilities and forbids gaining new ones, like the recipe worker", () => {
    expect(agent).toMatch(/cap_drop:\s*\n\s*- ALL/);
    expect(agent).toContain("no-new-privileges:true");
  });

  it("gives the worker longer to stop than it waits before releasing its task", () => {
    const stop = /stop_grace_period: (\d+)s/.exec(agent);
    const timing = loopTiming(300_000);
    expect(Number(stop?.[1]) * 1000).toBeGreaterThan(timing.shutdownGraceMs);
  });

  it("can reach Ollama on the host", () => {
    expect(agent).toContain("host.docker.internal:host-gateway");
  });

  it("passes on every agent setting that .env.example lists, and the config reads each one", () => {
    const keys = read(".env.example")
      .split("\n")
      .filter((line) => /^[A-Z_]+=/.test(line))
      .map((line) => line.split("=")[0] as string)
      .filter((key) => key.includes("AGENT") || key === "ANTHROPIC_API_KEY");
    expect(keys.length).toBeGreaterThan(5);
    for (const key of keys) expect(agent, key).toContain(`\${${key}`);
  });

  /** Settings the container deliberately does not let .env change, and why. */
  const FIXED_BY_THE_IMAGE: Record<string, string> = {
    KICKROCKS_SERVER_URL: "compose points it at the server service",
    KICKROCKS_CHROME_PROFILE: "compose mounts the profile volume at /profile",
    KICKROCKS_WORKER_HEADLESS:
      "the image runs a headed Chrome on Xvfb, which bot checks trust more",
    KICKROCKS_WORKER_NO_SANDBOX:
      "the image sets it, because Docker's seccomp profile blocks Chrome's sandbox",
    KICKROCKS_WORKER_ALLOW_HTTP: "plain http pages stay refused outside a test machine",
    KICKROCKS_CHROME_EXECUTABLE: "the image installs the one browser it uses",
    KICKROCKS_WORKER_POLL_MS: "the default suits a container",
    KICKROCKS_WORKER_LEASE_MS: "the default suits a container",
  };

  it("passes on every setting the config reads, unless the image fixes it on purpose", () => {
    for (const key of AGENT_ENV_KEYS) {
      if (key in FIXED_BY_THE_IMAGE) {
        expect(agent, `${key} is fixed, so compose must not offer it`).not.toMatch(
          new RegExp(`\\$\\{${key}[:}]`),
        );
      } else {
        expect(agent, `${key} is read by the worker but compose does not pass it`).toMatch(
          new RegExp(`^\\s+${key}: `, "m"),
        );
      }
    }
  });

  it("lists in .env.example every setting compose takes from it", () => {
    const listed = new Set(
      read(".env.example")
        .split("\n")
        .map((line) => /^#?\s*([A-Z_]+)=/.exec(line)?.[1])
        .filter((key): key is string => key !== undefined),
    );
    for (const match of agent.matchAll(/\$\{([A-Z_]+)[:}]/g)) {
      expect(listed.has(match[1] as string), `${match[1]} is not in .env.example`).toBe(true);
    }
  });

  it("starts the config from the empty values compose passes for settings left blank", () => {
    const blank = Object.fromEntries(
      [...agent.matchAll(/^\s+([A-Z_]+): \$\{[A-Z_]+:-\}$/gm)].map((match) => [match[1], ""]),
    );
    const config = loadAgentWorkerConfig({
      ...blank,
      KICKROCKS_WORKER_TOKEN: "a-token-of-sixteen-chars",
      KICKROCKS_AGENT_MODEL: "m",
    });
    expect(config.provider.baseUrl).toBe("http://localhost:11434/v1");
    expect(config.limits.maxSteps).toBe(40);
    expect(config.pricing).toBeNull();
  });
});

describe("the agent worker's image", () => {
  const dockerfile = read("apps/agent-worker/Dockerfile");

  it("lists every workspace manifest, so a frozen install sees the whole workspace", () => {
    for (const manifest of [
      "apps/server",
      "apps/web",
      "apps/worker",
      "apps/agent-worker",
      "e2e",
      "packages/shared",
      "packages/db",
      "packages/brokers",
      "packages/legal",
      "packages/recipes",
    ]) {
      expect(dockerfile, manifest).toContain(`COPY ${manifest}/package.json`);
    }
  });

  it("builds the packages it imports at run time, and runs as an unprivileged user", () => {
    for (const path of [
      "packages/shared",
      "packages/recipes",
      "apps/worker",
      "apps/agent-worker",
    ]) {
      expect(dockerfile, path).toContain(`COPY ${path} ${path}`);
    }
    expect(dockerfile).toContain("USER node");
  });

  it("keeps a developer's agent Chrome profile out of the build context", () => {
    expect(read(".dockerignore").split("\n")).toContain("**/.chrome-profile-agent");
  });
});
