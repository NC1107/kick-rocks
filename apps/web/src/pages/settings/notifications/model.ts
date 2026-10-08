import { NotificationsPatch, type NotificationsView, WebUrl } from "@kickrocks/shared";

export const DEFAULT_NTFY_SERVER = "https://ntfy.sh";

export const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

export const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

export const formatHourUtc = (hour: number): string => `${String(hour).padStart(2, "0")}:00 UTC`;

export interface NtfyDraft {
  serverUrl: string;
  topic: string;
  token: string;
  clearToken: boolean;
}

export function ntfyDraftOf(saved: NotificationsView["ntfy"]): NtfyDraft {
  return {
    serverUrl: saved?.serverUrl.replace(/\/$/, "") ?? DEFAULT_NTFY_SERVER,
    topic: saved?.topic ?? "",
    token: "",
    clearToken: false,
  };
}

export function ntfyDirty(draft: NtfyDraft, saved: NotificationsView["ntfy"]): boolean {
  const base = ntfyDraftOf(saved);
  if (saved === null) return draft.topic.trim() !== "" || draft.serverUrl.trim() !== base.serverUrl;
  return (
    draft.serverUrl.trim() !== base.serverUrl ||
    draft.topic.trim() !== base.topic ||
    draft.token !== "" ||
    draft.clearToken
  );
}

export interface TelegramDraft {
  botToken: string;
  chatId: string;
}

export function telegramDraftOf(saved: NotificationsView["telegram"]): TelegramDraft {
  return { botToken: "", chatId: saved?.chatId ?? "" };
}

export function telegramDirty(draft: TelegramDraft, saved: NotificationsView["telegram"]): boolean {
  if (saved === null) return draft.botToken !== "" || draft.chatId.trim() !== "";
  return draft.botToken !== "" || draft.chatId.trim() !== saved.chatId;
}

type Errors<K extends string> = Partial<Record<K, string>>;

export function checkNtfy(draft: NtfyDraft): {
  errors: Errors<"serverUrl" | "topic">;
  patch: NonNullable<NotificationsPatch["ntfy"]>;
} {
  const errors: Errors<"serverUrl" | "topic"> = {};
  const serverUrl = draft.serverUrl.trim();
  const topic = draft.topic.trim();
  if (!WebUrl.safeParse(serverUrl).success) {
    errors.serverUrl = "Enter a web address that starts with http:// or https://.";
  }
  if (topic === "") errors.topic = "Enter the topic name.";
  else if (!/^[A-Za-z0-9_-]{1,64}$/.test(topic)) {
    errors.topic = "Use letters, digits, dashes and underscores, up to 64.";
  }
  const token = draft.clearToken
    ? null
    : draft.token.trim() === ""
      ? undefined
      : draft.token.trim();
  return { errors, patch: { serverUrl, topic, ...(token === undefined ? {} : { token }) } };
}

export function checkTelegram(
  draft: TelegramDraft,
  saved: NotificationsView["telegram"],
): {
  errors: Errors<"botToken" | "chatId">;
  patch: NonNullable<NotificationsPatch["telegram"]>;
} {
  const errors: Errors<"botToken" | "chatId"> = {};
  const botToken = draft.botToken.trim();
  const chatId = draft.chatId.trim();
  const shape = NotificationsPatch.shape.telegram.unwrap().unwrap().shape;
  if (botToken === "") {
    if (!saved) errors.botToken = "Enter the bot token from BotFather.";
  } else if (!shape.botToken.safeParse(botToken).success) {
    errors.botToken = "That does not look like a bot token. It looks like 123456:ABC-DEF.";
  }
  if (chatId === "") errors.chatId = "Enter the chat ID.";
  else if (!shape.chatId.safeParse(chatId).success) {
    errors.chatId = "Use the numeric chat ID or an @channel name.";
  }
  return { errors, patch: { chatId, ...(botToken === "" ? {} : { botToken }) } };
}

export function checkMaxPerHour(text: string): { error?: string; value?: number } {
  const value = Number(text.trim());
  if (text.trim() === "" || !Number.isInteger(value)) return { error: "Enter a whole number." };
  if (value < 1 || value > 60) return { error: "Enter 1 to 60." };
  return { value };
}
