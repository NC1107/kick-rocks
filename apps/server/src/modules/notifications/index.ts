import { mailboxes } from "@kickrocks/db";
import {
  API_ROUTES,
  DigestSettings,
  type NotificationSettings,
  type NotificationsPatch,
  type NotificationsView,
  type NotificationTestResult,
  WebUrl,
} from "@kickrocks/shared";
import { conflict, invalidRequest } from "../../core/errors.js";
import { registerRoute } from "../../core/http.js";
import type { ModulePlugin } from "../../core/module.js";
import { definedOnly } from "../../core/objects.js";
import type { AppServices } from "../../services.js";
import { ChannelError, type PushMessage } from "./channels.js";
import { sendDigest, sendDigestIfDue } from "./digest.js";
import { pushNewAttention } from "./push.js";
import { readState, updateState } from "./state.js";

export { ChannelError, createNotificationChannels } from "./channels.js";
export { sendDigest, sendDigestIfDue } from "./digest.js";
export { pushNewAttention } from "./push.js";

/** One scheduler pass: announce what is new, then send the digest when it is due. */
export async function runNotifications(services: AppServices): Promise<void> {
  await pushNewAttention(services);
  await sendDigestIfDue(services);
}

function viewOf(services: AppServices): NotificationsView {
  const settings = services.settings.get("notifications");
  const state = readState(services);
  return {
    ntfy: settings.ntfy
      ? {
          serverUrl: settings.ntfy.serverUrl,
          topic: settings.ntfy.topic,
          tokenSet: settings.ntfy.token !== null,
        }
      : null,
    telegram: settings.telegram ? { chatId: settings.telegram.chatId, botTokenSet: true } : null,
    categories: settings.categories,
    maxPerHour: settings.maxPerHour,
    digest: settings.digest,
    appUrl: WebUrl.parse(services.config.publicUrl),
    mailboxReady: services.db.select({ id: mailboxes.id }).from(mailboxes).get() !== undefined,
    status: {
      lastSentAt: state.lastSentAt,
      lastError: state.lastError,
      digestLastSentAt: state.digestLastSentAt,
      digestLastError: state.digestLastError,
    },
  };
}

function sameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}

function applyPatch(services: AppServices, patch: NotificationsPatch): void {
  const stored = services.settings.get("notifications");
  const next: NotificationSettings = { ...stored };

  if (patch.ntfy === null) {
    next.ntfy = null;
  } else if (patch.ntfy) {
    const { serverUrl, topic, token } = patch.ntfy;
    const kept = stored.ntfy?.token ?? null;
    // A saved token is for one server and must not follow a changed address to another.
    if (
      token === undefined &&
      kept &&
      stored.ntfy &&
      !sameOrigin(stored.ntfy.serverUrl, serverUrl)
    ) {
      throw invalidRequest("The saved token is for a different server", [
        {
          path: ["body", "ntfy", "token"],
          message: "The server changed, so enter the token again",
        },
      ]);
    }
    next.ntfy = { serverUrl, topic, token: token === undefined ? kept : token };
  }

  if (patch.telegram === null) {
    next.telegram = null;
  } else if (patch.telegram) {
    const botToken = patch.telegram.botToken ?? stored.telegram?.botToken;
    if (!botToken) {
      throw invalidRequest("A bot token is required", [
        { path: ["body", "telegram", "botToken"], message: "Enter the bot token" },
      ]);
    }
    next.telegram = { botToken, chatId: patch.telegram.chatId };
  }

  if (patch.categories) next.categories = [...new Set(patch.categories)];
  if (patch.maxPerHour !== undefined) next.maxPerHour = patch.maxPerHour;
  if (patch.digest) {
    next.digest = DigestSettings.parse({ ...stored.digest, ...definedOnly(patch.digest) });
  }

  services.settings.set("notifications", next);

  // Turning the digest on starts its first period now, so it does not send a backlog at once.
  if (stored.digest.frequency === "off" && next.digest.frequency !== "off") {
    const now = services.clock.now().toISOString();
    updateState(services, () => ({
      digestLastSentAt: now,
      digestLastError: null,
      digestRetryAfter: null,
    }));
  }
}

async function sendTest(
  services: AppServices,
  channel: "ntfy" | "telegram",
): Promise<NotificationTestResult> {
  const settings = services.settings.get("notifications");
  const config = settings[channel];
  if (!config) {
    throw conflict("channel_not_configured", "Save this channel before sending a test");
  }
  const message: PushMessage = {
    title: "Kick Rocks test",
    body: `This is a test notification. Open ${services.config.publicUrl}`,
    url: services.config.publicUrl,
  };
  try {
    if (channel === "ntfy" && settings.ntfy) {
      await services.notificationChannels.ntfy(settings.ntfy, message);
    } else if (settings.telegram) {
      await services.notificationChannels.telegram(settings.telegram, message);
    }
    return { ok: true, error: null };
  } catch (error) {
    return { ok: false, error: error instanceof ChannelError ? error.message : "Could not send" };
  }
}

export const notificationsModule: ModulePlugin = (app, services) => {
  registerRoute(app, API_ROUTES.notificationsGet, () => viewOf(services));

  registerRoute(app, API_ROUTES.notificationsPatch, ({ body }) => {
    services.db.transaction(() => applyPatch(services, body));
    return viewOf(services);
  });

  registerRoute(app, API_ROUTES.notificationsTest, ({ body }) => sendTest(services, body.channel));

  registerRoute(app, API_ROUTES.notificationsDigestSend, () => sendDigest(services));
};
