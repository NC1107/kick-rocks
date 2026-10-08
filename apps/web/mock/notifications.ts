import { API_ROUTES, type NotificationsView, WebUrl } from "@kickrocks/shared";
import { conflict, handle, invalid, type MockRoute } from "./core.js";
import type { MockStore } from "./store.js";

/** A topic with this name makes the mock server refuse the test, so the failure state can be seen. */
const MOCK_REFUSED_TOPIC = "refused";

function sameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}

/**
 * The notification routes. The saved tokens stay in the store and never reach a response, as on
 * the real server.
 */
export function notificationRoutes(store: MockStore): MockRoute[] {
  const view = (): NotificationsView => {
    const { ntfy, telegram, categories, maxPerHour, digest } = store.notifications.settings;
    return {
      ntfy: ntfy
        ? { serverUrl: ntfy.serverUrl, topic: ntfy.topic, tokenSet: ntfy.token !== null }
        : null,
      telegram: telegram ? { chatId: telegram.chatId, botTokenSet: true } : null,
      categories,
      maxPerHour,
      digest,
      appUrl: WebUrl.parse(new URL(store.settings.mcp.url).origin),
      mailboxReady: store.profiles.length > 0,
      status: {
        lastSentAt: store.notifications.lastSentAt,
        lastError: store.notifications.lastError,
        digestLastSentAt: store.notifications.digestLastSentAt,
        digestLastError: store.notifications.digestLastError,
      },
    };
  };

  return [
    handle(API_ROUTES.notificationsGet, view),

    handle(API_ROUTES.notificationsPatch, ({ body }) => {
      const current = store.notifications.settings;
      if (body.ntfy === null) current.ntfy = null;
      else if (body.ntfy) {
        const kept = current.ntfy?.token ?? null;
        if (
          body.ntfy.token === undefined &&
          kept &&
          current.ntfy &&
          !sameOrigin(current.ntfy.serverUrl, body.ntfy.serverUrl)
        ) {
          throw invalid("The server changed, so enter the token again", ["body", "ntfy", "token"]);
        }
        current.ntfy = {
          serverUrl: body.ntfy.serverUrl,
          topic: body.ntfy.topic,
          token: body.ntfy.token === undefined ? kept : body.ntfy.token,
        };
      }
      if (body.telegram === null) current.telegram = null;
      else if (body.telegram) {
        const botToken = body.telegram.botToken ?? current.telegram?.botToken;
        if (!botToken) throw invalid("Enter the bot token", ["body", "telegram", "botToken"]);
        current.telegram = { botToken, chatId: body.telegram.chatId };
      }
      if (body.categories) current.categories = [...new Set(body.categories)];
      if (body.maxPerHour !== undefined) current.maxPerHour = body.maxPerHour;
      if (body.digest) {
        const wasOff = current.digest.frequency === "off";
        current.digest = {
          frequency: body.digest.frequency ?? current.digest.frequency,
          hourUtc: body.digest.hourUtc ?? current.digest.hourUtc,
          weekday: body.digest.weekday ?? current.digest.weekday,
        };
        if (wasOff && current.digest.frequency !== "off") {
          store.notifications.digestLastSentAt = store.clock.now().toISOString();
        }
      }
      return view();
    }),

    handle(API_ROUTES.notificationsTest, ({ body }) => {
      const channel = store.notifications.settings[body.channel];
      if (!channel) throw conflict("Save this channel before sending a test.");
      if (
        body.channel === "ntfy" &&
        store.notifications.settings.ntfy?.topic === MOCK_REFUSED_TOPIC
      ) {
        return { ok: false, error: "ntfy answered 403: forbidden" };
      }
      store.notifications.lastSentAt = store.clock.now().toISOString();
      return { ok: true, error: null };
    }),

    handle(API_ROUTES.notificationsDigestSend, () => {
      store.notifications.digestLastSentAt = store.clock.now().toISOString();
      store.notifications.digestLastError = null;
      return { outcome: "sent" as const, sent: 1, error: null };
    }),
  ];
}
