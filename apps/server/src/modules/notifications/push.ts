import type { NotificationCategory, NotificationSettings } from "@kickrocks/shared";
import type { AppServices } from "../../services.js";
import { type AttentionItem, collectAttention } from "./attention.js";
import type { PushMessage } from "./channels.js";
import { readState, updateState } from "./state.js";

const HOUR_MS = 60 * 60 * 1000;
/** After every channel refused a message, the next try waits this long so a dead server is not hammered. */
const RETRY_AFTER_FAILURE_MS = 5 * 60 * 1000;

export type PushOutcome = "unconfigured" | "idle" | "waiting" | "limited" | "sent" | "failed";

const PHRASES: Record<NotificationCategory, (count: number) => string> = {
  blocked_task: (n) => (n === 1 ? "1 task is blocked" : `${n} tasks are blocked`),
  verification: (n) =>
    n === 1 ? "1 verification needs approval" : `${n} verifications need approval`,
  match: (n) => (n === 1 ? "1 listing needs a decision" : `${n} listings need a decision`),
  mailbox: (n) => (n === 1 ? "1 mailbox error" : `${n} mailbox errors`),
  recipe: (n) => (n === 1 ? "1 recipe is broken" : `${n} recipes are broken`),
};

const ORDER: readonly NotificationCategory[] = [
  "blocked_task",
  "verification",
  "match",
  "mailbox",
  "recipe",
];

export function hasChannel(settings: NotificationSettings): boolean {
  return settings.ntfy !== null || settings.telegram !== null;
}

/** The page the message opens: Review when it holds any of the items, else the one place they share. */
function destinationOf(items: readonly AttentionItem[]): string {
  const paths = new Set(items.map((item) => item.path));
  if (paths.has("/review")) return "/review";
  return paths.size === 1 ? (items[0] as AttentionItem).path : "/";
}

/**
 * The words of a push. It states how many items need attention and links to the app, and never
 * names a broker, a person, or an address, because it crosses a third-party server.
 */
export function describeAttention(items: readonly AttentionItem[], appUrl: string): PushMessage {
  const counts = new Map<NotificationCategory, number>();
  for (const { category } of items) counts.set(category, (counts.get(category) ?? 0) + 1);
  const phrases = ORDER.flatMap((category) => {
    const count = counts.get(category);
    return count ? [PHRASES[category](count)] : [];
  });
  const url = `${appUrl}${destinationOf(items)}`;
  return {
    title: "Kick Rocks needs you",
    body: `${phrases.join(", ")}. Open ${url}`,
    url,
  };
}

/** Sends one message to every configured channel. Returns the failures, empty when all accepted it. */
export async function deliver(
  services: AppServices,
  settings: NotificationSettings,
  message: PushMessage,
): Promise<{ delivered: number; failures: string[] }> {
  const { notificationChannels: channels } = services;
  const sends: Promise<void>[] = [];
  if (settings.ntfy) sends.push(channels.ntfy(settings.ntfy, message));
  if (settings.telegram) sends.push(channels.telegram(settings.telegram, message));
  const results = await Promise.allSettled(sends);
  const failures = results.flatMap((result) =>
    result.status === "rejected"
      ? [result.reason instanceof Error ? result.reason.message : "Could not send"]
      : [],
  );
  return { delivered: results.length - failures.length, failures };
}

/**
 * Announces what became open since the last pass. Items are announced once while they stay open,
 * grouped into one message, and at most `maxPerHour` messages go out per hour; what the limit holds
 * back goes out in the next message that is allowed. A message no channel accepted is not counted
 * as announced, so it is tried again.
 */
export async function pushNewAttention(services: AppServices): Promise<PushOutcome> {
  const settings = services.settings.get("notifications");
  if (!hasChannel(settings)) return "unconfigured";

  const enabled = new Set(settings.categories);
  const open = collectAttention(services).filter((item) => enabled.has(item.category));
  const openKeys = new Set(open.map((item) => item.key));
  const state = readState(services);
  const stillOpen = state.announced.filter((key) => openKeys.has(key));
  const announced = new Set(stillOpen);
  const fresh = open.filter((item) => !announced.has(item.key));

  if (fresh.length === 0) {
    if (stillOpen.length !== state.announced.length) {
      updateState(services, () => ({ announced: stillOpen }));
    }
    return "idle";
  }

  const now = services.clock.now();
  if (state.retryAfter && Date.parse(state.retryAfter) > now.getTime()) return "waiting";
  const recent = state.sentAt.filter((at) => Date.parse(at) > now.getTime() - HOUR_MS);
  if (recent.length >= settings.maxPerHour) {
    updateState(services, () => ({ announced: stillOpen, sentAt: recent }));
    return "limited";
  }

  const message = describeAttention(fresh, services.config.publicUrl);
  const { delivered, failures } = await deliver(services, settings, message);
  const error = failures.length > 0 ? failures.join("; ") : null;
  if (delivered === 0) {
    services.logger.warn({ failures }, "could not send a notification");
    updateState(services, () => ({
      announced: stillOpen,
      sentAt: recent,
      lastError: error,
      retryAfter: new Date(now.getTime() + RETRY_AFTER_FAILURE_MS).toISOString(),
    }));
    return "failed";
  }
  updateState(services, () => ({
    announced: [...stillOpen, ...fresh.map((item) => item.key)],
    sentAt: [...recent, now.toISOString()],
    lastSentAt: now.toISOString(),
    lastError: error,
    retryAfter: null,
  }));
  return "sent";
}
