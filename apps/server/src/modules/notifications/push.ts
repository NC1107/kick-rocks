import type { NotificationCategory, NotificationSettings, PushChannel } from "@kickrocks/shared";
import type { AppServices } from "../../services.js";
import { type AttentionItem, collectAttention, WORKER_OFFLINE_KEY } from "./attention.js";
import type { PushMessage } from "./channels.js";
import { readState, updateState } from "./state.js";

const HOUR_MS = 60 * 60 * 1000;
/** An item resolved this recently is not announced again, so a flapping error is one push. */
const RESOLVED_COOLDOWN_MS = HOUR_MS;
/** After a channel refused a message, the next try waits this long so a dead server is not hammered. */
const RETRY_AFTER_FAILURE_MS = 5 * 60 * 1000;

type PushOutcome = "unconfigured" | "idle" | "waiting" | "limited" | "sent" | "failed";

const PHRASES: Record<NotificationCategory, (count: number) => string> = {
  blocked_task: (n) => (n === 1 ? "1 task is blocked" : `${n} tasks are blocked`),
  verification: (n) =>
    n === 1 ? "1 verification needs approval" : `${n} verifications need approval`,
  match: (n) => (n === 1 ? "1 listing needs a decision" : `${n} listings need a decision`),
  mailbox: (n) => (n === 1 ? "1 mailbox error" : `${n} mailbox errors`),
  recipe: (n) => (n === 1 ? "1 recipe is broken" : `${n} recipes are broken`),
  worker: () => "The worker is offline and browser work is waiting",
};

const WORKER_ABSENT_PHRASE = "The worker has not reported for over a day";

const ORDER: readonly NotificationCategory[] = [
  "blocked_task",
  "verification",
  "match",
  "mailbox",
  "recipe",
  "worker",
];

function hasChannel(settings: NotificationSettings): boolean {
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
function describeAttention(items: readonly AttentionItem[], appUrl: string): PushMessage {
  const counts = new Map<NotificationCategory, number>();
  for (const { category } of items) counts.set(category, (counts.get(category) ?? 0) + 1);
  const workerWaiting = items.some((item) => item.key === WORKER_OFFLINE_KEY);
  const phrases = ORDER.flatMap((category) => {
    const count = counts.get(category);
    if (!count) return [];
    if (category === "worker" && !workerWaiting) return [WORKER_ABSENT_PHRASE];
    return [PHRASES[category](count)];
  });
  const url = `${appUrl}${destinationOf(items)}`;
  return {
    title: "Kick Rocks needs you",
    body: `${phrases.join(", ")}. Open ${url}`,
    url,
  };
}

const CHANNELS: readonly PushChannel[] = ["ntfy", "telegram"];

/** Sends one message through one channel. Returns the failure text, null when it accepted it. */
async function deliver(
  services: AppServices,
  settings: NotificationSettings,
  channel: PushChannel,
  message: PushMessage,
): Promise<string | null> {
  const { notificationChannels: channels } = services;
  try {
    if (channel === "ntfy" && settings.ntfy) await channels.ntfy(settings.ntfy, message);
    else if (channel === "telegram" && settings.telegram) {
      await channels.telegram(settings.telegram, message);
    }
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : "Could not send";
  }
}

/**
 * Announces what became open since the last pass. Each channel keeps its own record, so one that
 * refused a message gets it again later without the other hearing it twice. Items are announced
 * once while they stay open, grouped into one message per channel, and at most `maxPerHour` passes
 * send per hour; what the limit holds back goes out in the next pass that is allowed. An item that
 * was resolved is not announced again within the cooldown, so a flapping error is one push.
 */
export async function pushNewAttention(services: AppServices): Promise<PushOutcome> {
  const settings = services.settings.get("notifications");
  if (!hasChannel(settings)) return "unconfigured";

  const now = services.clock.now();
  const enabled = new Set(settings.categories);
  const open = collectAttention(services).filter((item) => enabled.has(item.category));
  const openKeys = new Set(open.map((item) => item.key));
  const state = readState(services);

  const stillOpen = {
    ntfy: state.announced.ntfy.filter((key) => openKeys.has(key)),
    telegram: state.announced.telegram.filter((key) => openKeys.has(key)),
  };
  const resolvedAt: Record<string, string> = {};
  for (const [key, at] of Object.entries(state.resolvedAt)) {
    if (Date.parse(at) > now.getTime() - RESOLVED_COOLDOWN_MS) {
      resolvedAt[key] = at;
    }
  }
  for (const key of new Set([...state.announced.ntfy, ...state.announced.telegram])) {
    if (!openKeys.has(key)) resolvedAt[key] = state.resolvedAt[key] ?? now.toISOString();
  }
  const bookkeeping = { announced: stillOpen, resolvedAt };
  const bookkeepingChanged =
    stillOpen.ntfy.length !== state.announced.ntfy.length ||
    stillOpen.telegram.length !== state.announced.telegram.length ||
    Object.keys(resolvedAt).length !== Object.keys(state.resolvedAt).length;

  const configured = CHANNELS.filter((channel) => settings[channel] !== null);
  const fresh = new Map<PushChannel, AttentionItem[]>();
  for (const channel of configured) {
    const seen = new Set(stillOpen[channel]);
    const items = open.filter((item) => !seen.has(item.key) && !(item.key in resolvedAt));
    if (items.length > 0) fresh.set(channel, items);
  }

  if (fresh.size === 0) {
    if (bookkeepingChanged) updateState(services, () => bookkeeping);
    return "idle";
  }

  const ready = [...fresh.keys()].filter((channel) => {
    const retryAfter = state.retryAfter[channel];
    return !retryAfter || Date.parse(retryAfter) <= now.getTime();
  });
  if (ready.length === 0) {
    if (bookkeepingChanged) updateState(services, () => bookkeeping);
    return "waiting";
  }
  const recent = state.sentAt.filter((at) => Date.parse(at) > now.getTime() - HOUR_MS);
  if (recent.length >= settings.maxPerHour) {
    updateState(services, () => ({ ...bookkeeping, sentAt: recent }));
    return "limited";
  }

  const outcomes = await Promise.all(
    ready.map(async (channel) => {
      const items = fresh.get(channel) as AttentionItem[];
      const message = describeAttention(items, services.config.publicUrl);
      return { channel, items, failure: await deliver(services, settings, channel, message) };
    }),
  );

  const announced = { ...stillOpen };
  const retryAfter = { ...state.retryAfter };
  const failures: string[] = [];
  for (const { channel, items, failure } of outcomes) {
    if (failure === null) {
      announced[channel] = [...stillOpen[channel], ...items.map((item) => item.key)];
      retryAfter[channel] = null;
    } else {
      failures.push(failure);
      retryAfter[channel] = new Date(now.getTime() + RETRY_AFTER_FAILURE_MS).toISOString();
    }
  }
  const error = failures.length > 0 ? failures.join("; ") : null;
  const delivered = outcomes.length - failures.length;
  if (delivered === 0) services.logger.warn({ failures }, "could not send a notification");

  updateState(services, () => ({
    ...bookkeeping,
    announced,
    retryAfter,
    sentAt: delivered > 0 ? [...recent, now.toISOString()] : recent,
    lastSentAt: delivered > 0 ? now.toISOString() : state.lastSentAt,
    lastError: error,
  }));
  return delivered > 0 ? "sent" : "failed";
}
