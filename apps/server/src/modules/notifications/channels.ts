import type { NtfySettings, TelegramSettings } from "@kickrocks/shared";

/** What a push says. The body carries counts and one link to the app, never names or addresses. */
export interface PushMessage {
  title: string;
  body: string;
  /** Where tapping the notification leads. */
  url: string;
}

/** A failure whose message is safe to store and show: it never contains a token or a server URL. */
export class ChannelError extends Error {
  override name = "ChannelError";
}

export interface NotificationChannels {
  ntfy(config: NtfySettings, message: PushMessage): Promise<void>;
  telegram(config: TelegramSettings, message: PushMessage): Promise<void>;
}

export interface ChannelDeps {
  fetch?: typeof fetch;
  /** Replaced in tests; the Bot API lives at one address. */
  telegramBaseUrl?: string;
  timeoutMs?: number;
}

const TELEGRAM_API = "https://api.telegram.org";
const DEFAULT_TIMEOUT_MS = 10_000;
const TELEGRAM_TEXT_LIMIT = 4096;

async function post(
  fetchImpl: typeof fetch,
  label: string,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  try {
    return await fetchImpl(url, {
      ...init,
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    throw new ChannelError(
      timedOut ? `${label} did not answer in time` : `Could not reach ${label}`,
    );
  }
}

/** The reason a service gave, when it gave one in a short JSON body. */
async function reasonOf(response: Response): Promise<string | null> {
  try {
    const parsed: unknown = JSON.parse((await response.text()).slice(0, 2000));
    if (typeof parsed !== "object" || parsed === null) return null;
    const { description, error } = parsed as { description?: unknown; error?: unknown };
    const reason = typeof description === "string" ? description : error;
    return typeof reason === "string" ? reason.replace(/\s+/g, " ").trim().slice(0, 200) : null;
  } catch {
    return null;
  }
}

export function createNotificationChannels({
  fetch: fetchImpl = fetch,
  telegramBaseUrl = TELEGRAM_API,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: ChannelDeps = {}): NotificationChannels {
  return {
    async ntfy(config, message) {
      const base = config.serverUrl.replace(/\/+$/, "");
      const headers: Record<string, string> = {
        title: message.title,
        click: message.url,
        "content-type": "text/plain; charset=utf-8",
      };
      if (config.token) headers.authorization = `Bearer ${config.token}`;
      const response = await post(
        fetchImpl,
        "ntfy",
        `${base}/${encodeURIComponent(config.topic)}`,
        { headers, body: message.body },
        timeoutMs,
      );
      if (!response.ok) {
        const reason = await reasonOf(response);
        throw new ChannelError(`ntfy answered ${response.status}${reason ? `: ${reason}` : ""}`);
      }
    },

    async telegram(config, message) {
      const text = `${message.title}\n${message.body}`.slice(0, TELEGRAM_TEXT_LIMIT);
      const response = await post(
        fetchImpl,
        "Telegram",
        `${telegramBaseUrl.replace(/\/+$/, "")}/bot${config.botToken}/sendMessage`,
        {
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            chat_id: config.chatId,
            text,
            disable_web_page_preview: true,
          }),
        },
        timeoutMs,
      );
      if (!response.ok) {
        const reason = await reasonOf(response);
        throw new ChannelError(
          `Telegram answered ${response.status}${reason ? `: ${reason}` : ""}`,
        );
      }
    },
  };
}
