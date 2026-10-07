import { describe, expect, it } from "vitest";
import { call, freshMockAppEachTest } from "./test-helpers.js";

freshMockAppEachTest();

const BOT_TOKEN = "123456789:AAExampleTokenValue_abcdefghijklmnop";
const patch = (body: Record<string, unknown>) =>
  call({ method: "PATCH", path: "/notifications", body });

describe("notification handlers", () => {
  it("starts with nothing configured", async () => {
    const view = await call({ path: "/notifications" });
    expect(view.json).toMatchObject({
      ntfy: null,
      telegram: null,
      maxPerHour: 6,
      digest: { frequency: "off" },
    });
  });

  it("saves channels and never returns a token", async () => {
    const saved = await patch({
      ntfy: { serverUrl: "https://ntfy.sh", topic: "kr_alerts", token: "tk_secret" },
      telegram: { botToken: BOT_TOKEN, chatId: "42" },
    });
    expect(saved.json.ntfy).toEqual({
      serverUrl: "https://ntfy.sh",
      topic: "kr_alerts",
      tokenSet: true,
    });
    expect(saved.json.telegram).toEqual({ chatId: "42", botTokenSet: true });
    expect(JSON.stringify(saved.json)).not.toContain("tk_secret");
    expect(JSON.stringify(saved.json)).not.toContain(BOT_TOKEN);
  });

  it("keeps a saved token when it is omitted and refuses to move it to another server", async () => {
    await patch({ ntfy: { serverUrl: "https://ntfy.sh", topic: "kr_alerts", token: "tk_secret" } });
    const same = await patch({ ntfy: { serverUrl: "https://ntfy.sh", topic: "other" } });
    expect(same.json.ntfy.tokenSet).toBe(true);
    const moved = await patch({ ntfy: { serverUrl: "https://ntfy.example.org", topic: "other" } });
    expect(moved.status).toBe(400);
  });

  it("asks for a bot token the first time", async () => {
    expect((await patch({ telegram: { chatId: "42" } })).status).toBe(400);
  });

  it("starts the digest period when it is switched on", async () => {
    const view = await patch({ digest: { frequency: "daily" } });
    expect(view.json.status.digestLastSentAt).not.toBeNull();
  });

  it("answers a test only for a saved channel, and can show a refusal", async () => {
    const test = (channel: string) =>
      call({ method: "POST", path: "/notifications/test", body: { channel } });
    expect((await test("ntfy")).status).toBe(409);

    await patch({ ntfy: { serverUrl: "https://ntfy.sh", topic: "kr_alerts" } });
    expect((await test("ntfy")).json).toEqual({ ok: true, error: null });

    await patch({ ntfy: { serverUrl: "https://ntfy.sh", topic: "refused" } });
    expect((await test("ntfy")).json).toEqual({
      ok: false,
      error: "ntfy answered 403: forbidden",
    });
  });

  it("sends a digest on request", async () => {
    const sent = await call({ method: "POST", path: "/notifications/digest/send" });
    expect(sent.json).toEqual({ outcome: "sent", sent: 1, error: null });
  });
});
