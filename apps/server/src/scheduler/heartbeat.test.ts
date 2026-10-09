import { describe, expect, it, vi } from "vitest";
import { createHeartbeat } from "./heartbeat.js";

const URL_WITH_SECRET = "https://hc-ping.example/6f1b9c2e-secret-slug";

function recordingLogger() {
  const lines: string[] = [];
  const record = (...args: unknown[]) => void lines.push(JSON.stringify(args));
  return { lines, logger: { warn: record, info: record, error: record } as never };
}

describe("createHeartbeat", () => {
  it("is off without an address", () => {
    expect(createHeartbeat({ heartbeatUrl: null }, recordingLogger().logger)).toBeNull();
  });

  it("requests the address with a plain GET that does not follow redirects", async () => {
    const fetchImpl = vi.fn(async () => new Response("OK"));
    const beat = createHeartbeat(
      { heartbeatUrl: URL_WITH_SECRET },
      recordingLogger().logger,
      fetchImpl,
    );
    await beat?.ping();
    expect(fetchImpl).toHaveBeenCalledWith(
      URL_WITH_SECRET,
      expect.objectContaining({ method: "GET", redirect: "error" }),
    );
  });

  it("never throws and never writes the address to the log when the monitor is down or refuses", async () => {
    const { lines, logger } = recordingLogger();
    const down = createHeartbeat(
      { heartbeatUrl: URL_WITH_SECRET },
      logger,
      vi.fn(async () => {
        throw new Error(`connect ECONNREFUSED ${URL_WITH_SECRET}`);
      }),
    );
    const refusing = createHeartbeat(
      { heartbeatUrl: URL_WITH_SECRET },
      logger,
      vi.fn(async () => new Response("no", { status: 404 })),
    );
    await expect(down?.ping()).resolves.toBeUndefined();
    await expect(refusing?.ping()).resolves.toBeUndefined();
    expect(lines.length).toBe(2);
    expect(lines.join("\n")).not.toContain("secret-slug");
  });
});
