import type { NotificationState } from "@kickrocks/shared";
import type { AppServices } from "../../services.js";

export function readState({ settings }: AppServices): NotificationState {
  return settings.get("notifications.state");
}

/** Applies a change to the stored state. Passes never overlap, so read-modify-write is safe. */
export function updateState(
  { settings }: AppServices,
  change: (state: NotificationState) => Partial<NotificationState>,
): NotificationState {
  const current = settings.get("notifications.state");
  const next = { ...current, ...change(current) };
  settings.set("notifications.state", next);
  return next;
}
