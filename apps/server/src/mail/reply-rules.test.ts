import { describe, expect, it } from "vitest";
import {
  appliesWithoutPerson,
  matchSignals,
  PROVEN_RULES,
  RULES,
  requestedFieldsIn,
  type Signal,
  STRUCTURAL_READINGS,
} from "./reply-rules.js";

function signalsFor(text: string, subject = ""): Signal[] {
  return matchSignals({
    message: {
      subject,
      from: { name: null, address: "privacy@broker.test" },
      isBounce: false,
      autoSubmitted: false,
      headers: {},
    },
    body: text,
  });
}

const topOf = (text: string) => signalsFor(text)[0] ?? null;
const rulesFor = (text: string) => signalsFor(text).map((signal) => signal.rule);

/**
 * Each case is a paraphrase in the shape of a reply the rules once misread, with invented names
 * and wording. None is text from a real reply.
 */
describe("shapes of real replies the rules once misread", () => {
  describe("a polite opener is not an acknowledgement", () => {
    it("reads thanks for contacting us alone as nothing", () => {
      expect(signalsFor("Thank you for contacting Example Corp. We hope this helps.")).toEqual([]);
    });

    it("reads a thank-you before a refusal as the refusal", () => {
      expect(topOf("Thanks for reaching out. We are unable to delete your account.")).toMatchObject(
        { classification: "rejected" },
      );
    });

    it("reads a thank-you before a finished removal as the removal", () => {
      expect(
        topOf(
          "Thank you for your request. Acme has processed and completed the removal of your data.",
        ),
      ).toMatchObject({ classification: "completed", rule: "provider-did-it" });
    });

    it("does not take the start of an email address for the word email", () => {
      expect(
        rulesFor(
          "We received your email address with a request to exercise your rights. Confirm it with the link below within 3 days.",
        ),
      ).not.toContain("acknowledged");
    });

    it("does not take a response time alone for an acknowledgement", () => {
      expect(rulesFor("Our answer comes within 30 days.")).not.toContain("acknowledged");
    });

    it("still reads a plain receipt as an acknowledgement", () => {
      expect(topOf("We have received your request.")).toMatchObject({
        classification: "auto_ack",
        rule: "acknowledged",
      });
    });
  });

  describe("a request to do it yourself or elsewhere", () => {
    it("reads signing in and deleting it yourself as a redirect, ahead of the refusal beside it", () => {
      const reply =
        "Hello. We are unable to delete accounts for users, so you will need to sign in to your account and delete it yourself from the settings page.";
      expect(signalsFor(reply).map((signal) => signal.classification)).toEqual(
        expect.arrayContaining(["needs_form", "rejected"]),
      );
      expect(topOf(reply)).toMatchObject({ classification: "needs_form", rule: "do-it-yourself" });
    });

    it("reads a plain statement that the account can be deactivated as a redirect", () => {
      expect(
        topOf(
          "Thanks for your question. You can deactivate your account at any time from its settings. Search engines may keep copies.",
        ),
      ).toMatchObject({ classification: "needs_form" });
    });

    it("reads app instructions as a redirect even when the law is declined", () => {
      expect(
        topOf(
          "We are a small company and are not covered under that law. You can send your deletion request following the instructions for your device: open Settings and tap Delete.",
        ),
      ).toMatchObject({ classification: "needs_form" });
    });

    it("reads a refusal that names a new form as the only way as a redirect", () => {
      expect(
        topOf(
          "Your subscription is still active, so we were unable to fulfill your deletion request. Once it is cancelled you should submit a new data request form.",
        ),
      ).toMatchObject({ classification: "needs_form" });
    });

    it("keeps an online form request a redirect even with an ID sentence next to it", () => {
      const reply =
        "Please use the following form to send your request: https://example.test/form. If you send a copy of your government-issued ID with it, we delete the copy after 30 days.";
      expect(topOf(reply)).toMatchObject({ classification: "needs_form" });
      expect(rulesFor(reply)).not.toContain("identity-document");
    });

    it("does not read a portal named for somebody else as a redirect for this person", () => {
      expect(
        rulesFor(
          "If the consumer cannot or does not wish to use our Portal, they may reply with the identifiers instead.",
        ),
      ).not.toContain("use-online-form");
    });

    it("does not read a mailbox to send something to as a request for the field", () => {
      expect(
        rulesFor(
          "Please send the work email address you want removed to privacy@broker.test, where our team handles these directly.",
        ),
      ).not.toContain("more-information");
    });
  });

  describe("a request for identity", () => {
    it("does not read how a portal verifies people as a request for ID", () => {
      expect(
        rulesFor(
          "Mailing in personal details is not an option for identity verification here. Our online portal handles identity verification for everyone.",
        ),
      ).not.toContain("identity-document");
    });

    it("does not read what happens to other people as a request for ID", () => {
      expect(
        rulesFor("Consumers who were unable to verify their identity may try again later."),
      ).not.toContain("identity-document");
    });

    it("does not read a click-to-confirm sentence as a request for ID", () => {
      expect(
        rulesFor(
          "By clicking the link below you confirm the verification of your identity and we will start work.",
        ),
      ).not.toContain("identity-document");
    });

    it("does not read a list of what is not collected as a request for ID", () => {
      expect(
        rulesFor(
          "We do not collect or hold your name, email, phone number, address, or any government-issued ID number.",
        ),
      ).not.toContain("identity-document");
    });

    it("reads an asked-for document as a request for ID", () => {
      expect(
        topOf("To go on we need a copy of your passport or a driver's license."),
      ).toMatchObject({ classification: "verification_required", rule: "identity-document" });
    });

    it("reads a plain request to verify identity as a request for ID", () => {
      expect(topOf("We must verify your identity before we can go on.")).toMatchObject({
        classification: "verification_required",
      });
    });

    it("reads a failed verification as a request for more", () => {
      expect(
        topOf("Your data was not deleted because we could not verify your identity."),
      ).toMatchObject({ classification: "verification_required", rule: "identity-unverified" });
    });
  });

  describe("a request for information", () => {
    it("reads a list after a colon as the information asked for, ahead of a refusal", () => {
      const reply = [
        "Thanks for getting in touch. We cannot fully delete accounts, but we can block yours.",
        "",
        "If you want that, please let us know and provide us with the following information:",
        "",
        "Name used at signup",
        "Date of birth",
      ].join("\n");
      expect(topOf(reply)).toMatchObject({
        classification: "verification_required",
        rule: "more-information",
      });
    });

    it("reads a request for the listing's link as a request for information, ahead of the missing record", () => {
      const reply =
        "We're unable to locate your name on our site. Could you please provide a direct link (URL) to the page that shows your details? Otherwise we will close your request.";
      expect(topOf(reply)).toMatchObject({ classification: "verification_required" });
      expect(requestedFieldsIn(reply)).toContain("record_url");
    });

    it("does not read the city in a site's name as the city field", () => {
      expect(
        requestedFieldsIn("Please provide the link to your page on town-data.example."),
      ).not.toContain("city");
    });

    it("reads a demand for identifiers as a request, ahead of the conditional refusal after it", () => {
      expect(
        topOf(
          "We only handle device advertising identifiers. To fulfil your request you must submit the advertising identifiers of your devices. Without them we will not be able to process your request.",
        ),
      ).toMatchObject({ classification: "verification_required" });
    });

    it("does not read an invitation to send more later as a request", () => {
      expect(
        rulesFor(
          "We found nothing. You may submit a new request with any new or additional information at any time.",
        ),
      ).not.toContain("more-information");
    });
  });

  describe("a missing record or a refusal", () => {
    it("reads a model-output search that found nothing as a refusal, not a missing record", () => {
      expect(
        topOf(
          "We reviewed your submission and were unable to identify any examples of your information in an answer from one of our assistants. We cannot take further action on your request.",
        ),
      ).toMatchObject({ classification: "rejected" });
    });

    it("reads the same refusal with a screenshot request as a refusal", () => {
      expect(
        topOf(
          "We are unable to identify any examples of your information in an answer from our assistant. Please attach a screenshot of one if you have it.",
        ),
      ).not.toMatchObject({ classification: "no_record" });
    });

    it("reads a processor's answer about another user's data as a refusal", () => {
      expect(
        topOf(
          "Thanks for reaching out. We cannot delete data stored in another user's workspace. We act as the processor there, and the workspace owner is the controller, so please contact them.",
        ),
      ).toMatchObject({ classification: "rejected" });
    });

    it("reads a legal-hold refusal to delete as a refusal", () => {
      expect(
        topOf(
          "Thanks for your note. Because of record-keeping rules we are unable to delete your account, but you can hide your profile.",
        ),
      ).toMatchObject({ classification: "rejected" });
    });

    it("reads a statement that the company generally holds no personal data as a missing record", () => {
      expect(
        topOf(
          "We generally don't have personal data about people. If none of these cases fits you, then your request is complete.",
        ),
      ).toMatchObject({ classification: "no_record" });
    });

    it("does not read a refusal as done because of a conditional sentence", () => {
      expect(rulesFor("If nothing above applies to you, your request is complete.")).not.toContain(
        "we-have-done",
      );
    });

    it("reads a finished deletion beside a missing second record as finished", () => {
      expect(
        topOf(
          "We have completed deletion of the data tied to the email you gave. We could not find any data for the phone number you gave.",
        ),
      ).toMatchObject({ classification: "completed" });
    });

    it("does not read a finished review as a finished request", () => {
      expect(
        topOf("We have completed our review and were unable to locate any information about you."),
      ).toMatchObject({ classification: "no_record" });
    });
  });

  describe("a request that was done", () => {
    it("reads a company that processed the request and listed the person as done", () => {
      expect(
        signalsFor(
          "We received your request and processed the request. We added your details to our suppression list.",
        ).map((signal) => signal.classification),
      ).toContain("completed");
    });

    it("reads a company that complied with the opt-out as done", () => {
      expect(
        topOf(
          "Thank you for submitting your request. Per your note, Acme has complied with your opt-out request.",
        ),
      ).toMatchObject({ classification: "completed" });
    });
  });
});

describe("which readings are applied without a person", () => {
  it("applies only the three wording rules measured before they were touched", () => {
    expect([...PROVEN_RULES].sort()).toEqual([
      "email-not-accepted",
      "has-been-done",
      "must-use-other-channel",
    ]);
  });

  it("names every wording rule once, and every proven one exists", () => {
    const ids = RULES.map((rule) => rule.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of PROVEN_RULES) expect(ids).toContain(id);
  });

  it("applies the structural readings and nothing that has no source", () => {
    expect([...STRUCTURAL_READINGS].sort()).toEqual(["confirmation-link", "delivery-report"]);
    expect(appliesWithoutPerson("delivery-report")).toBe(true);
    expect(appliesWithoutPerson("confirmation-link")).toBe(true);
    expect(appliesWithoutPerson("acknowledged")).toBe(false);
    expect(appliesWithoutPerson(null)).toBe(false);
  });
});
