import type { NeedsYouItem } from "@kickrocks/shared";
import { describeFailure } from "../../lib/failures.js";
import { itemTitle } from "./focus/model.js";
import type { QueueEntry } from "./model.js";

/** "7 min" or "40 sec": the time left on a hold, rounded up so it never promises more than it has. */
export function timeLeft(expiresAt: string, now: number): string | null {
  const seconds = Math.ceil((Date.parse(expiresAt) - now) / 1000);
  if (seconds <= 0) return null;
  return seconds < 60 ? `${seconds} sec` : `${Math.ceil(seconds / 60)} min`;
}

const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);

function needsYouHeadline(item: NeedsYouItem, now: number): string {
  const name = itemTitle(item);
  switch (item.kind) {
    case "hold": {
      const left = item.expiresAt === null ? null : timeLeft(item.expiresAt, now);
      return left
        ? `Sending a removal request to ${name} in ${left} unless you stop it.`
        : `The hold on the request to ${name} ran out.`;
    }
    case "approve":
      return `A request to ${name} paused before sending. Check what goes out, then approve it.`;
    case "check_sent":
      return `Did the removal form on ${name} go through? Open the page to check.`;
    case "captcha":
      return `${name} wants a CAPTCHA solved before the removal can be sent.`;
    case "phone_code":
      return `${name} texted you a code. Enter it on their page to finish the removal.`;
    case "id":
      return `${name} asks for a photo ID before it will remove you. Share it only if you want to.`;
    case "email_link":
      return `${name} emailed you a link. Tap it to confirm the removal.`;
    case "login":
      return `${name} wants you signed in before the removal can be sent.`;
    case "bot":
      return `${name} blocked our browser. Finish the form in yours.`;
    case "by_hand":
      return `${name} can only be removed by hand. Open the page and finish the form.`;
    case "record": {
      const site = "match" in item.source ? item.source.match.targetName : name;
      return `We found a listing on ${site}. Is it you?`;
    }
    case "details":
      return `${name} wants more details before it will act. Pick what to send.`;
  }
}

function entryHeadline(entry: QueueEntry): string {
  switch (entry.kind) {
    case "mail": {
      const { message } = entry;
      return message.requestId === null
        ? `A reply from ${message.fromAddress} doesn't match an open request. Is it about one of these?`
        : `${message.targetName ?? message.fromAddress} replied, and we couldn't tell what it means. What is it?`;
    }
    case "failed": {
      const { task } = entry.item;
      const cause = lowerFirst(describeFailure(task).label);
      return `The removal for ${task.targetName ?? "this site"} failed: ${cause}. Retry it or dismiss it.`;
    }
    case "agents": {
      const { task } = entry.item;
      return `Waiting for an agent to remove you from ${task.targetName ?? "this site"}. You can finish it yourself.`;
    }
  }
}

/**
 * The one sentence a review item opens with: what will happen and what the person decides. It
 * reads the item's kind and nothing technical, so the raw fields can live under Details.
 */
export function headlineFor(item: NeedsYouItem | QueueEntry, now: number = Date.now()): string {
  return "source" in item ? needsYouHeadline(item, now) : entryHeadline(item);
}
