import { type ReplyCase, reply } from "./tuning/reply-cases.js";

/**
 * Replies in the shape of one seen live: a privacy mailbox that opens with thanks for the contact
 * and then says requests only count through a web form or by phone. The opening reads like an
 * acknowledgement, which is what makes the class easy to get wrong. Every name and domain is invented.
 */
export const LIVE_SHAPE_DEV_CASES: ReplyCase[] = [
  reply(
    "live-form-1",
    "needs_form",
    "plain",
    "RE: Privacy request",
    `
Thank you for contacting us.

Requests to delete or opt out of the sale of personal information must be submitted through our web form at https://privacy.northgate-data.example/request or by calling 1-800-555-0142.

We are unable to process requests received by email.`,
    "thanks first, then says requests must go through the web form or by phone",
  ),
  reply(
    "live-form-2",
    "needs_form",
    "legal",
    "Your data request",
    `
Thank you for contacting Harbor Lane Information Services.

To protect your privacy, we can only act on requests made through our online request form (https://harborlane.example/privacy-form) or by phone at 888-555-0177.
Please use one of those two methods.

Privacy Office`,
    "an opening thank-you followed by a restriction to the form or phone",
  ),
  reply(
    "live-form-3",
    "needs_form",
    "autoresponder",
    "Auto-reply: Thank you for contacting us",
    `
Thank you for contacting our privacy team.

Email is not a valid way to make a deletion request. Requests must be submitted via our web form: https://www.quillfinder.example/data-rights, or by phone on 877-555-0109.`,
    "an automatic reply that still requires the form or phone",
  ),
];

export const LIVE_SHAPE_HELDOUT_CASES: ReplyCase[] = [
  reply(
    "held-live-form-1",
    "needs_form",
    "plain",
    "Re: Opt-out request",
    `
Hello and thank you for contacting us.

We accept opt-out and deletion requests through our web form only (https://optout.redbirch-lists.example/start) or through our toll free number, 1-866-555-0123.
Messages sent to this address will not be actioned.`,
    "thanks first, then form or phone only",
  ),
  reply(
    "held-live-form-2",
    "needs_form",
    "ticket",
    "[Case 55102] Thank you for contacting us",
    `
Thank you for contacting us regarding your privacy request.

Please be advised that all privacy requests must be submitted using the form on our Privacy Center, or by phone at 1-855-555-0188, in order to be processed.

Case 55102 has been closed.`,
    "a ticket reply that closes the case and points to the form or phone",
  ),
];
