import type { NeedsYouItem, ProfileField } from "@kickrocks/shared";

/** An "Open the page" older than this no longer asks, since the person has surely moved on. */
export const OPENED_FRESH_MS = 2 * 60 * 60 * 1000;
export const UNDO_MS = 5_000;
export const COPIED_MS = 1_500;

export function itemTitle(item: NeedsYouItem): string {
  if ("match" in item.source) return item.source.match.fields.name;
  if ("verification" in item.source) return item.source.verification.request.target.name;
  return item.source.task.task.targetName ?? "Unknown target";
}

/** Whether an item's "Open the page" is recent enough to ask about when the page loads. */
export function openedRecently(item: Pick<NeedsYouItem, "openedAt">, now: number): boolean {
  if (item.openedAt === null) return false;
  const age = now - new Date(item.openedAt).getTime();
  return age >= 0 && age < OPENED_FRESH_MS;
}

/**
 * The progress of a sitting: how many were dealt with, how many are left, and where the open one
 * stands, which moves as the person browses the items still waiting.
 */
export function progressOf(done: number, remaining: number, index = 0) {
  const total = done + remaining;
  return { done, total, position: Math.min(done + index + 1, Math.max(total, 1)) };
}

/** "~15 sec" or "~2 min", short enough for the end of a header line. */
export function effortLabel(minutes: number): string {
  return minutes < 1 ? `~${Math.round(minutes * 60)} sec` : `~${Math.round(minutes)} min`;
}

/** The same in the narrow Up next list: "~15s", "~2m". */
export function effortShort(minutes: number): string {
  return minutes < 1 ? `~${Math.round(minutes * 60)}s` : `~${Math.round(minutes)}m`;
}

/** `m:ss`, for the time a held request has left. */
export function clockLeft(expiresAt: string | null, now: number): string | null {
  if (expiresAt === null) return null;
  const seconds = Math.max(0, Math.ceil((new Date(expiresAt).getTime() - now) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** The item after (or before) this one in the order shown, wrapping at the ends. */
export function neighbour(
  keys: readonly string[],
  current: string | null,
  step: 1 | -1,
): string | null {
  if (keys.length === 0) return null;
  const index = current === null ? -1 : keys.indexOf(current);
  if (index === -1) return keys[step === 1 ? 0 : keys.length - 1] ?? null;
  return keys[(index + step + keys.length) % keys.length] ?? null;
}

/**
 * The key to show: the one the address names, else the item now at the position the last one held,
 * so dealing with an item moves on to the next.
 */
export function pickKey(
  keys: readonly string[],
  named: string | null,
  lastIndex: number,
): string | null {
  if (named !== null && keys.includes(named)) return named;
  return keys[Math.min(Math.max(lastIndex, 0), keys.length - 1)] ?? null;
}

export interface SnoozePreset {
  id: "hour" | "tonight" | "tomorrow" | "week";
  label: string;
  until: Date;
}

const atHour = (day: Date, hour: number): Date => {
  const result = new Date(day);
  result.setHours(hour, 0, 0, 0);
  return result;
};

/** The four times a snooze can end, in the person's own time zone. Tonight is left out once it has passed. */
export function snoozePresets(now: Date): SnoozePreset[] {
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const monday = new Date(now);
  monday.setDate(monday.getDate() + ((8 - monday.getDay()) % 7 || 7));
  const tonight = atHour(now, 18);
  return [
    { id: "hour" as const, label: "1 hour", until: new Date(now.getTime() + 60 * 60 * 1000) },
    ...(tonight > now ? [{ id: "tonight" as const, label: "Tonight", until: tonight }] : []),
    { id: "tomorrow" as const, label: "Tomorrow", until: atHour(tomorrow, 9) },
    { id: "week" as const, label: "Next week", until: atHour(monday, 9) },
  ];
}

/** "Snoozed till 9 AM", with the weekday once it is not today or tomorrow's morning. */
export function snoozedLine(until: Date, now: Date): string {
  const minutes = until.getMinutes();
  const hour = until.getHours() % 12 === 0 ? 12 : until.getHours() % 12;
  const clock = `${hour}${minutes === 0 ? "" : `:${String(minutes).padStart(2, "0")}`} ${until.getHours() < 12 ? "AM" : "PM"}`;
  const sameDay = until.toDateString() === now.toDateString();
  const nextDay = new Date(now);
  nextDay.setDate(nextDay.getDate() + 1);
  if (sameDay || until.toDateString() === nextDay.toDateString()) return `Snoozed till ${clock}`;
  const day = until.toLocaleDateString("en-US", { weekday: "short" });
  return `Snoozed till ${day} ${clock}`;
}

/** The first letter and a run of dots, which hides a value without hiding how long it is not. */
const hidden = (text: string) => `${text.slice(0, 1)}•••`;

/** A value with most of it hidden, for a chip that has not been tapped yet. */
export function maskValue(field: ProfileField, value: string): string {
  switch (field) {
    case "email": {
      const at = value.indexOf("@");
      return at <= 0 ? hidden(value) : `${hidden(value)}${value.slice(at)}`;
    }
    case "phone": {
      const last = value.replace(/\D/g, "").slice(-4);
      return last ? `•••-•••-${last}` : "•••";
    }
    case "date_of_birth":
      return value.replace(/^(\d{4})-\d{2}-\d{2}$/, "$1-••-••");
    case "birth_year":
      return value;
    case "record_url":
      return "••••";
    default:
      return value
        .split(/\s+/)
        .map((word) => hidden(word))
        .join(" ");
  }
}

/** A value cut to fit a small chip, for fields that are shown as they are. */
export function clip(text: string, length = 12): string {
  return text.length > length ? `${text.slice(0, length)}…` : text;
}
