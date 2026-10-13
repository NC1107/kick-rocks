import type { NeedsYouItem, NeedsYouKind } from "@kickrocks/shared";
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
        ? `Sends to ${name} in ${left} unless you stop it.`
        : `The hold on the request to ${name} ran out.`;
    }
    case "approve":
      return `The request to ${name} paused. Check what goes out, then approve it.`;
    case "check_sent":
      return `Did the form on ${name} go through? Open the page to check.`;
    case "captcha":
      return `${name} needs a CAPTCHA solved before it can send.`;
    case "phone_code":
      return `${name} texted you a code. Enter it on their page.`;
    case "id":
      return `${name} asks for a photo ID. Share it only if you want to.`;
    case "email_link":
      return `${name} emailed you a link. Tap it to confirm.`;
    case "login":
      return `${name} wants you signed in before it can send.`;
    case "bot":
      return `${name} blocked our browser. Finish the form in yours.`;
    case "by_hand":
      return `${name} can only be done by hand. Open the page and finish the form.`;
    case "record": {
      const site = "match" in item.source ? item.source.match.targetName : name;
      return `We found a listing on ${site}. Is it you?`;
    }
    case "details":
      return `${name} wants more details. Pick what to send.`;
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

const SHORT_LABELS: Record<NeedsYouKind, string> = {
  hold: "Stop or send",
  details: "Pick details",
  approve: "Approve",
  phone_code: "Enter their code",
  captcha: "Solve CAPTCHA",
  bot: "Finish in browser",
  record: "Is this you?",
  email_link: "Confirm by email",
  check_sent: "Check it went through",
  id: "Share ID or not",
  login: "Sign in",
  by_hand: "Finish by hand",
};

/** A few words under the target name in the Up next list: what the person will do, as an imperative. */
export const shortLabel = (item: Pick<NeedsYouItem, "kind">): string => SHORT_LABELS[item.kind];
