import { describe, expect, it } from "vitest";
import { sentenceContradictsEmail } from "./coverage-measure.js";

const CURRENT = "privacy@broker.test";

describe("sentenceContradictsEmail", () => {
  it.each([
    [
      "the-data-group",
      'Email explicitly "will not be processed" (2026-08-21) - The Data Group is a processor for its clients, not a data controller; use the portal form.',
    ],
    [
      "videoamp",
      "VideoAmp will not process any request not submitted via their web form (2026-08-21).",
    ],
    [
      "steppingblocks",
      'Reply says the request should go through the opt_out_url form, "the designated channel" (2026-08-21).',
    ],
    [
      "semasio",
      "Reply says they can't act on email requests and to use the existing opt_out_url (2026-08-21).",
    ],
    [
      "spy-dialer",
      "Reply says this address is not intended for privacy-related requests - use the opt_out_url form instead (2026-08-21).",
    ],
    [
      "datonics",
      "Reply (2026-08-21) requires deletion/opt-out requests to go through this Privacy Choices page.",
    ],
    [
      "nextroll",
      "Reply directs to this privacy-request portal instead of email (2026-08-21); old opt_out_url (adroll.com) replaced with their current one.",
    ],
  ])("flags the %s reply", (_id, sentence) => {
    expect(sentenceContradictsEmail(sentence, CURRENT)).toBe(true);
  });

  it("does not let a replaced URL excuse a reply, but lets a different address excuse it", () => {
    const reply = "Reply directs to this privacy-request portal instead of email";
    expect(
      sentenceContradictsEmail(`${reply}; old link replaced with the current one.`, CURRENT),
    ).toBe(true);
    expect(sentenceContradictsEmail(`${reply}; corrected to other@broker.test.`, CURRENT)).toBe(
      false,
    );
  });

  it("flags a bounce of the current address and excuses a bounce of another", () => {
    expect(sentenceContradictsEmail(`${CURRENT} hard-bounced (2026-08-20).`, CURRENT)).toBe(true);
    expect(sentenceContradictsEmail("info@broker.test hard-bounced (2026-08-20).", CURRENT)).toBe(
      false,
    );
  });

  it("leaves a note about something else alone", () => {
    expect(sentenceContradictsEmail("Asked for a copy of government-issued ID.", CURRENT)).toBe(
      false,
    );
  });
});
