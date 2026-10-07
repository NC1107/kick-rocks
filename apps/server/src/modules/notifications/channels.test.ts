import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ChannelError, createNotificationChannels, type PushMessage } from "./channels.js";
import { type FakePushServer, startFakePushServer } from "./fake-push-server.js";

let server: FakePushServer;

beforeEach(async () => {
  server = await startFakePushServer();
});

afterEach(async () => {
  await server.close();
});

const BOT_TOKEN = "123456789:AAExampleTokenValue_abcdefghijklmnop";
const message: PushMessage = {
  title: "Kick Rocks needs you",
  body: "1 task is blocked. Open http://kickrocks.test/review",
  url: "http://kickrocks.test/review",
};

describe("ntfy", () => {
  it("posts the body to the topic with the title and click link as headers", async () => {
    const channels = createNotificationChannels();
    await channels.ntfy({ serverUrl: `${server.url}/`, topic: "kr_alerts", token: null }, message);

    expect(server.requests).toHaveLength(1);
    const [sent] = server.requests;
    expect(sent?.method).toBe("POST");
    expect(sent?.url).toBe("/kr_alerts");
    expect(sent?.body).toBe(message.body);
    expect(sent?.headers.title).toBe(message.title);
    expect(sent?.headers.click).toBe(message.url);
    expect(sent?.headers.authorization).toBeUndefined();
  });

  it("sends the access token as a bearer credential when one is saved", async () => {
    await createNotificationChannels().ntfy(
      { serverUrl: server.url, topic: "kr_alerts", token: "tk_secret" },
      message,
    );
    expect(server.requests[0]?.headers.authorization).toBe("Bearer tk_secret");
  });

  it("reports the status and reason when the server refuses, without the token or address", async () => {
    server.respondWith(403, JSON.stringify({ error: "forbidden" }));
    const failure = await createNotificationChannels()
      .ntfy({ serverUrl: server.url, topic: "kr_alerts", token: "tk_secret" }, message)
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ChannelError);
    expect((failure as Error).message).toBe("ntfy answered 403: forbidden");
    expect((failure as Error).message).not.toContain("tk_secret");
    expect((failure as Error).message).not.toContain(server.url);
  });

  it("does not follow a redirect, so a token never travels to another host", async () => {
    server.respondWith(302, "", { location: "http://127.0.0.1:1/elsewhere" });
    await expect(
      createNotificationChannels().ntfy(
        { serverUrl: server.url, topic: "kr_alerts", token: "tk_secret" },
        message,
      ),
    ).rejects.toThrow("Could not reach ntfy");
  });

  it("says the server could not be reached", async () => {
    const closed = await startFakePushServer();
    const { url } = closed;
    await closed.close();
    await expect(
      createNotificationChannels().ntfy(
        { serverUrl: url, topic: "kr_alerts", token: null },
        message,
      ),
    ).rejects.toThrow("Could not reach ntfy");
  });

  it("gives up on a server that never answers", async () => {
    server.stallFor(500);
    await expect(
      createNotificationChannels({ timeoutMs: 50 }).ntfy(
        { serverUrl: server.url, topic: "kr_alerts", token: null },
        message,
      ),
    ).rejects.toThrow("ntfy did not answer in time");
  });
});

describe("Telegram", () => {
  it("posts a JSON message to the bot's sendMessage method", async () => {
    await createNotificationChannels({ telegramBaseUrl: server.url }).telegram(
      { botToken: BOT_TOKEN, chatId: "-1001234567" },
      message,
    );

    const [sent] = server.requests;
    expect(sent?.method).toBe("POST");
    expect(sent?.url).toBe(`/bot${BOT_TOKEN}/sendMessage`);
    expect(sent?.headers["content-type"]).toBe("application/json");
    expect(JSON.parse(sent?.body ?? "")).toEqual({
      chat_id: "-1001234567",
      text: `${message.title}\n${message.body}`,
      disable_web_page_preview: true,
    });
  });

  it("reports Telegram's description of a refusal without the bot token", async () => {
    server.respondWith(401, JSON.stringify({ ok: false, description: "Unauthorized" }));
    const failure = await createNotificationChannels({ telegramBaseUrl: server.url })
      .telegram({ botToken: BOT_TOKEN, chatId: "42" }, message)
      .catch((error: unknown) => error);

    expect((failure as Error).message).toBe("Telegram answered 401: Unauthorized");
    expect((failure as Error).message).not.toContain(BOT_TOKEN);
  });

  it("keeps the failure free of the bot token when the network fails", async () => {
    const closed = await startFakePushServer();
    const { url } = closed;
    await closed.close();
    const failure = await createNotificationChannels({ telegramBaseUrl: url })
      .telegram({ botToken: BOT_TOKEN, chatId: "42" }, message)
      .catch((error: unknown) => error);

    expect((failure as Error).message).toBe("Could not reach Telegram");
  });
});
