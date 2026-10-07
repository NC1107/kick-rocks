import { execFileSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT =
  process.env.KICKROCKS_REPO_ROOT ?? resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (path: string): string => readFileSync(resolve(ROOT, path), "utf8");

const compose = read("docker-compose.yml");
const readme = read("README.md");

/** The text of one top-level service block of the compose file. */
function service(name: string): string {
  const start = compose.indexOf(`\n  ${name}:\n`);
  expect(start, `service ${name}`).toBeGreaterThan(-1);
  const rest = compose.slice(start + 1);
  const next = rest.slice(1).search(/\n {2}\S|\n\S/);
  return next === -1 ? rest : rest.slice(0, next + 1);
}

describe("docker build context", () => {
  const ignored = read(".dockerignore").split("\n");

  it("keeps a developer's database, key, Chrome profile, and env files out of the images", () => {
    for (const pattern of [
      "apps/*/data",
      "**/.chrome-profile",
      "**/*.db",
      "**/*.db-*",
      "**/*.key",
      ".env",
      ".env.*",
    ]) {
      expect(ignored, pattern).toContain(pattern);
    }
  });

  it("does not hide the committed broker datasets the build reads", () => {
    expect(ignored).not.toContain("**/data");
  });
});

describe("docker-compose.yml", () => {
  it("fixes the project name, so the volume name in the README is the one that exists", () => {
    expect(compose).toMatch(/^name: kick-rocks$/m);
    expect(readme).toContain("kick-rocks_kickrocks-data");
  });

  it("gives the worker longer to stop than it waits before releasing its task", () => {
    const grace = Number(
      /shutdownGraceMs: (\d[\d_]*)/
        .exec(read("apps/worker/src/claim-loop.ts"))?.[1]
        ?.replaceAll("_", ""),
    );
    const stop = /stop_grace_period: (\d+)s/.exec(service("worker"));
    expect(Number.isFinite(grace)).toBe(true);
    expect(Number(stop?.[1]) * 1000).toBeGreaterThan(grace);
  });

  it("drops the worker's capabilities and forbids gaining new ones", () => {
    const worker = service("worker");
    expect(worker).toMatch(/cap_drop:\s*\n\s*- ALL/);
    expect(worker).toContain("no-new-privileges:true");
  });

  it("passes on every setting that .env.example leaves uncommented", () => {
    const keys = read(".env.example")
      .split("\n")
      .filter((line) => /^[A-Z_]+=/.test(line))
      .map((line) => line.split("=")[0] as string);
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) expect(compose, key).toContain(`\${${key}`);
  });

  it("waits for a healthy server before it starts either worker", () => {
    expect(service("server")).toContain("healthcheck:");
    for (const name of ["worker", "agent-worker"]) {
      expect(service(name), name).toMatch(
        /depends_on:\s*\n\s*server:\s*\n\s*condition: service_healthy/,
      );
    }
  });

  it("publishes the UI on loopback unless the person chooses another address", () => {
    expect(compose).toContain("KICKROCKS_BIND_ADDRESS:-127.0.0.1");
  });
});

describe("README.md", () => {
  it("stops everything before it copies the database, and says how to restore and what -v does", () => {
    const backup = readme.indexOf("tar czf");
    expect(readme.lastIndexOf("docker compose stop", backup)).toBeGreaterThan(-1);
    expect(readme).toContain("tar xzf");
    expect(readme).toContain("down -v");
  });

  it("writes the backup owner-only and outside the repository, and warns that it holds the key", () => {
    expect(readme).toContain("umask 077");
    expect(readme).not.toMatch(/-v "\$PWD":\/backup/);
    expect(readme).toMatch(/off shared folders and cloud storage/);
    expect(read(".gitignore").split("\n")).toContain("kickrocks-backup*");
  });

  it("gives the stop, start, and uninstall commands and the disk and build time", () => {
    for (const text of [
      "--stop",
      "--start",
      "--uninstall",
      "COMPOSE_PROFILES=worker",
      "GB",
      "minutes",
    ]) {
      expect(readme, text).toContain(text);
    }
  });

  it("says no site is visited until site checks are turned on", () => {
    expect(readme).toContain("Nothing visits a broker site until you say so");
    expect(readme).toContain("Site checks");
  });

  it("asks for a state, which the profile form requires", () => {
    expect(readme).toContain("name, email, and state of residence");
  });

  it("explains how to reach the UI from another device", () => {
    expect(readme).toContain("ssh -L 8420:127.0.0.1:8420");
    expect(readme).toContain("KICKROCKS_BIND_ADDRESS");
  });

  it("builds before `pnpm dev` and does not send people to a Campaigns nav item", () => {
    const steps = readme.slice(readme.indexOf("## Developing"));
    expect(steps.indexOf("pnpm build")).toBeGreaterThan(-1);
    expect(steps.indexOf("pnpm build")).toBeLessThan(steps.indexOf("pnpm dev "));
    expect(readme).not.toContain("Open Campaigns");
  });

  it("covers updating and logs", () => {
    expect(readme).toContain("docker compose up -d --build");
    expect(readme).toContain("docker compose logs");
  });
});

describe("root scripts", () => {
  const scripts = (JSON.parse(read("package.json")) as { scripts: Record<string, string> }).scripts;

  it("`pnpm dev` starts the server and web but not the worker, which needs a token", () => {
    expect(scripts.dev).toContain("@kickrocks/server");
    expect(scripts.dev).toContain("@kickrocks/web");
    expect(scripts.dev).not.toContain("./apps/**");
    expect(scripts["dev:worker"]).toContain("@kickrocks/worker");
  });
});

describe("Dockerfiles", () => {
  const workspaceApps = ["server", "web", "worker", "agent-worker"];

  it.each(["Dockerfile", "apps/worker/Dockerfile", "apps/agent-worker/Dockerfile"])(
    "%s copies every app manifest so the frozen lockfile still matches",
    (dockerfile) => {
      for (const app of workspaceApps) {
        expect(read(dockerfile)).toContain(`COPY apps/${app}/package.json apps/${app}/`);
      }
    },
  );
});

describe("CI", () => {
  it("builds the docker images", () => {
    expect(read(".github/workflows/ci.yml")).toContain(
      "docker compose --profile worker --profile agent build",
    );
  });
});

describe("docs/agents.md", () => {
  const agents = read("docs/agents.md");

  it("says the agent needs a browser tool, on the home connection, headed", () => {
    expect(agents).toContain("browser automation tool");
    expect(agents).toContain("WebFetch");
    expect(agents).toMatch(/headed/);
  });

  it("does not require a screenshot", () => {
    expect(agents).not.toContain("and a screenshot of what a person will see");
  });
});

describe("docs/DESIGN.md", () => {
  const design = read("docs/DESIGN.md");

  it("names the MCP tools and routes the code has", () => {
    expect(design).toContain("claim_task");
    expect(design).not.toContain("`tasks.claim`");
    expect(design).not.toContain("GET /api/brokers");
  });

  it("does not promise a passphrase mode as built", () => {
    expect(design).toContain("is not built");
  });
});

describe("install.sh", () => {
  const urlFor = (env: string): string => {
    const dir = mkdtempSync(join(tmpdir(), "kickrocks-install-"));
    try {
      copyFileSync(resolve(ROOT, "install.sh"), join(dir, "install.sh"));
      writeFileSync(join(dir, ".env"), env);
      return execFileSync("bash", [join(dir, "install.sh"), "--url"], { encoding: "utf8" }).trim();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };

  it("writes COMPOSE_PROFILES so every compose command sees the worker", () => {
    const script = read("install.sh");
    expect(script).toContain("COMPOSE_PROFILES=");
    for (const flag of ["--stop", "--start", "--backup", "--uninstall"]) {
      expect(script, flag).toContain(flag);
    }
    expect(script).toContain("umask 077");
    expect(script).toContain("--wait");
  });

  it("prints the address compose publishes by default", () => {
    expect(urlFor("KICKROCKS_WORKER_TOKEN=\n")).toBe("http://127.0.0.1:8420");
  });

  it("prints the configured port and bind address", () => {
    expect(urlFor("KICKROCKS_BIND_ADDRESS=192.168.1.20\nKICKROCKS_HOST_PORT=9000\n")).toBe(
      "http://192.168.1.20:9000",
    );
  });

  it("prints loopback when the server listens on every interface", () => {
    expect(urlFor("KICKROCKS_BIND_ADDRESS=0.0.0.0\nKICKROCKS_HOST_PORT=9000\n")).toBe(
      "http://127.0.0.1:9000",
    );
  });

  it("strips double and single quotes around a value, as compose does", () => {
    expect(urlFor("KICKROCKS_BIND_ADDRESS=\"192.168.1.20\"\nKICKROCKS_HOST_PORT='9000'\n")).toBe(
      "http://192.168.1.20:9000",
    );
    expect(urlFor("KICKROCKS_PUBLIC_URL='https://kickrocks.example.org/'\n")).toBe(
      "https://kickrocks.example.org",
    );
  });

  it("brackets an IPv6 bind address", () => {
    expect(urlFor("KICKROCKS_BIND_ADDRESS=::1\nKICKROCKS_HOST_PORT=9000\n")).toBe(
      "http://[::1]:9000",
    );
    expect(urlFor('KICKROCKS_BIND_ADDRESS="fd00::20"\n')).toBe("http://[fd00::20]:8420");
    expect(urlFor("KICKROCKS_BIND_ADDRESS=[::1]\n")).toBe("http://[::1]:8420");
  });

  it("prefers the public URL, without a trailing slash", () => {
    expect(
      urlFor("KICKROCKS_PUBLIC_URL=https://kickrocks.example.org/\nKICKROCKS_HOST_PORT=9000\n"),
    ).toBe("https://kickrocks.example.org");
  });

  describe("with a stand-in docker", () => {
    const FAKE_DOCKER = `#!/usr/bin/env bash
echo "$*" >> "$FAKE_LOG"
case "$*" in
  "compose version") ;;
  "volume inspect "*) ;;
  *"config") echo "name: kr" ;;
  *"ps --services --status running") printf '%s' "$FAKE_RUNNING" ;;
  "run "*) echo data ;;
esac
`;

    const run = (args: string[], options: { running?: string; cwd?: "caller" | "repo" } = {}) => {
      const dir = mkdtempSync(join(tmpdir(), "kickrocks-install-"));
      try {
        const repo = join(dir, "repo");
        const caller = join(dir, "caller");
        const bin = join(dir, "bin");
        for (const path of [repo, caller, bin]) mkdirSync(path);
        copyFileSync(resolve(ROOT, "install.sh"), join(repo, "install.sh"));
        writeFileSync(join(bin, "docker"), FAKE_DOCKER);
        chmodSync(join(bin, "docker"), 0o755);
        const log = join(dir, "log");
        writeFileSync(log, "");
        let failed = false;
        try {
          execFileSync("bash", [join(repo, "install.sh"), ...args], {
            cwd: options.cwd === "repo" ? repo : caller,
            encoding: "utf8",
            stdio: "pipe",
            env: {
              ...process.env,
              PATH: `${bin}:${process.env.PATH}`,
              FAKE_LOG: log,
              FAKE_RUNNING: options.running ?? "",
            },
          });
        } catch {
          failed = true;
        }
        return {
          failed,
          calls: readFileSync(log, "utf8").trim().split("\n"),
          env: existsSync(join(repo, ".env")) ? readFileSync(join(repo, ".env"), "utf8") : "",
          callerFiles: readdirSync(caller),
          repoFiles: readdirSync(repo),
        };
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    };

    it("--start adds the worker profile for an install from before it existed", () => {
      const result = run(["--start"]);
      expect(result.env).toContain("COMPOSE_PROFILES=worker");
      expect(result.calls).toContain("compose up -d --wait");
    });

    it("--backup writes a relative file next to where it was run, not inside the repository", () => {
      const result = run(["--backup", "mine.tgz"]);
      expect(result.failed).toBe(false);
      expect(result.callerFiles).toContain("mine.tgz");
      expect(result.repoFiles).not.toContain("mine.tgz");
    });

    it("--backup refuses a relative file when run from inside the repository", () => {
      const result = run(["--backup", "mine.tgz"], { cwd: "repo" });
      expect(result.failed).toBe(true);
      expect(result.repoFiles).not.toContain("mine.tgz");
    });

    it("--backup starts again only what was running, in every profile", () => {
      const result = run(["--backup", "b.tgz"], { running: "server\nagent-worker\n" });
      expect(result.calls.at(-1)).toBe(
        "compose --profile worker --profile agent start server agent-worker",
      );
    });

    it("--backup starts nothing when everything was stopped", () => {
      const result = run(["--backup", "b.tgz"], { running: "" });
      expect(result.calls.some((call) => / start( |$)/.test(call))).toBe(false);
    });
  });
});

describe("the reverse proxy and LAN docs", () => {
  it("name the 421 refusal and the settings that fix it", () => {
    for (const text of [
      "421",
      "KICKROCKS_ALLOWED_HOSTS",
      "KICKROCKS_TRUST_PROXY",
      "KICKROCKS_PUBLIC_URL",
    ]) {
      expect(readme, text).toContain(text);
    }
  });
});
