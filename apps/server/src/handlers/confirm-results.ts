import { WebUrl } from "@kickrocks/shared";
import type { AppServices } from "../services.js";

/**
 * A confirmation link a browser opened is written to the timeline. Once it is confirmed the
 * request stops waiting for the broker's email, and the broker's next reply says whether it took.
 */
export function registerConfirmHandlers(services: AppServices): void {
  services.taskHandlers.on("confirm", "completed", ({ task, actor }) => {
    if (task.requestId === null) return;
    const request = services.requests.get(task.requestId);
    if (!request) return;

    // A person who marked it done by hand gave no result and did follow the link.
    const confirmed = task.result?.confirmed ?? true;
    const finalUrl = task.result?.finalUrl;
    services.requests.addEvent(request.id, {
      type: "link_followed",
      actor,
      payload: {
        url: task.payload.url,
        finalUrl: finalUrl !== undefined && WebUrl.safeParse(finalUrl).success ? finalUrl : null,
        ok: confirmed,
      },
    });
    if (confirmed && request.awaitingConfirmationSince !== null) {
      services.requests.update(request.id, { awaitingConfirmationSince: null });
    }
  });
}
