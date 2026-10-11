import type { AppServices } from "../services.js";

/** How long before an event a rescan looks, since a quick reply can pass the cursor before the event is recorded. */
const RESCAN_LEAD_MS = 15 * 60 * 1000;

/**
 * Asks for another look at one target's recent mail, from shortly before `at`. It is best effort:
 * a rescan only recovers mail the cursor already passed, so failing to queue one must never
 * undo the send or the form result that asked for it.
 */
export function requestRescan(
  services: Pick<AppServices, "dispatch" | "logger">,
  mailboxId: string,
  targetId: string,
  at: Date,
): void {
  try {
    services.dispatch.enqueueInboxPoll(mailboxId, {
      rescan: { since: new Date(at.getTime() - RESCAN_LEAD_MS).toISOString(), targetId },
    });
  } catch (error) {
    services.logger.warn({ mailboxId, targetId, err: String(error) }, "could not queue a rescan");
  }
}
