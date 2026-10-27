import { describe, expect, it } from "vitest";
import {
  appliesWithoutPerson,
  matchSignals,
  PROVEN_RULES,
  RULES,
  requestedFieldsIn,
  type Signal,
  STRUCTURAL_READINGS,
  WAITING_READINGS,
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
        topOf("Thanks for writing in. Acme has fulfilled your removal request."),
      ).toMatchObject({ classification: "completed", rule: "provider-did-it" });
    });

    it("does not take the start of an email address for the word email", () => {
      expect(
        rulesFor(
          "We received your email address along with a request about your rights. Confirm it using the link below within 3 days.",
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
        "Hello. We cannot remove accounts on a user's behalf, so you will need to sign in to your account and delete it yourself from the settings page.";
      expect(signalsFor(reply).map((signal) => signal.classification)).toEqual(
        expect.arrayContaining(["needs_form", "rejected"]),
      );
      expect(topOf(reply)).toMatchObject({ classification: "needs_form", rule: "do-it-yourself" });
    });

    it("reads a plain statement that the account can be deactivated as a redirect", () => {
      expect(
        topOf(
          "Thanks for your question. You can deactivate your account from the settings page whenever you wish. Search engines may keep copies.",
        ),
      ).toMatchObject({ classification: "needs_form" });
    });

    it("reads app instructions as a redirect even when the law is declined", () => {
      expect(
        topOf(
          "We are a small company and are not covered under that law. Go ahead following the instructions on your device: open Settings and tap Delete.",
        ),
      ).toMatchObject({ classification: "needs_form" });
    });

    it("reads a refusal that names a new form as the only way as a redirect", () => {
      expect(
        topOf(
          "Your subscription is still active, so the deletion cannot go ahead yet. Once it is cancelled you should submit a new data request form.",
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
          "Should the individual be unwilling to open our Portal, a reply carrying the identifiers will do.",
        ),
      ).not.toContain("use-online-form");
    });

    it("does not read a mailbox to send something to as a request for the field", () => {
      expect(
        rulesFor(
          "Please mail the work address you want removed to privacy@broker.test, where our team handles these directly.",
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
          "Clicking this button counts as your confirmation that you are who you say, and then we begin.",
        ),
      ).not.toContain("identity-document");
    });

    it("does not read a list of what is not collected as a request for ID", () => {
      expect(
        rulesFor(
          "We neither collect nor keep your name, email, phone number, address, or any government-issued ID number.",
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
        "If you want that, please send the following details:",
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
        "We could not locate your name on our site. Please provide the direct link (URL) to the page that shows your details, or the ticket closes.";
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
          "We only handle device advertising identifiers. To act on this you must submit the advertising identifiers of your devices. Lacking those, nothing can proceed.",
        ),
      ).toMatchObject({ classification: "verification_required" });
    });

    it("does not read an invitation to send more later as a request", () => {
      expect(
        rulesFor(
          "We found nothing. A fresh request is welcome whenever you have extra identifiers to share.",
        ),
      ).not.toContain("more-information");
    });
  });

  describe("a missing record or a refusal", () => {
    it("reads a model-output search that found nothing as a refusal, not a missing record", () => {
      expect(
        topOf(
          "Our team looked at your submission and could not identify your details in a response our assistants generated. Our team cannot take any additional action here.",
        ),
      ).toMatchObject({ classification: "rejected" });
    });

    it("reads the same refusal with a screenshot request as a refusal", () => {
      expect(
        topOf(
          "We could not identify any of your details in a response from our assistant. Please attach a screenshot of one if you have it.",
        ),
      ).not.toMatchObject({ classification: "no_record" });
    });

    it("reads a processor's answer about another user's data as a refusal", () => {
      expect(
        topOf(
          "Thanks for reaching out. We cannot delete data stored in another user's workspace. We act as the processor there, and the owner of that workspace decides what happens to it, so please contact them.",
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
        topOf("We have completed the review of your file but could not find any data on you."),
      ).toMatchObject({ classification: "no_record" });
    });
  });

  describe("a request that was done", () => {
    it("reads a company that processed the request and listed the person as done", () => {
      expect(
        signalsFor(
          "Your note arrived and the matter was handled. Your details were added to our suppression list.",
        ).map((signal) => signal.classification),
      ).toContain("completed");
    });

    it("reads a company that complied with the opt-out as done", () => {
      expect(
        topOf(
          "Thank you for submitting your request. Per your note, Acme has complied with the opt-out you asked for.",
        ),
      ).toMatchObject({ classification: "completed" });
    });
  });
});

describe("a refusal or a redirect that borrows the wording of a finished request", () => {
  it("does not read a request that was processed and denied as done", () => {
    const reply =
      "Your request has been processed and denied because you are not a Texas resident.";
    expect(rulesFor(reply)).toContain("declined");
    expect(rulesFor(reply)).not.toContain("has-been-done");
    expect(topOf(reply)).toMatchObject({ classification: "rejected" });
  });

  it("reads a residency refusal that names any state as a refusal", () => {
    expect(topOf("We cannot help here, as you are not an Ohio resident.")).toMatchObject({
      classification: "rejected",
    });
  });

  it("does not read a request that was merely handled as done", () => {
    expect(rulesFor("The case has been processed by our team.")).not.toContain("has-been-done");
  });

  it("holds a honored request that cannot find a second detail back from completed", () => {
    const reply =
      "Your request has been honored for the email address provided. We could not find the phone number.";
    expect(signalsFor(reply).map((signal) => signal.classification)).toEqual(
      expect.arrayContaining(["completed", "no_record"]),
    );
  });
});

describe("a reply that keeps email as the channel or asks for authorization", () => {
  it("does not read a sender-address requirement as a move to a form", () => {
    expect(
      rulesFor(
        "Your request must be sent from the email address on your account. Details are at https://acme.test/help.",
      ),
    ).not.toContain("email-not-accepted");
  });

  it("does not read a request that must come by email as a move to a form", () => {
    const reply =
      "Requests must be submitted by the consumer themselves via email at help@acme.test.";
    expect(rulesFor(reply)).not.toContain("email-not-accepted");
    expect(rulesFor(reply)).not.toContain("must-use-other-channel");
  });

  it("does not read a link that explains an authorization as the channel", () => {
    expect(
      rulesFor(
        "Requests submitted on behalf of another person must include a signed authorization, as explained at https://acme.test/privacy",
      ),
    ).not.toContain("must-use-other-channel");
  });

  it("still reads a request that must go through a named form as a redirect", () => {
    expect(rulesFor("Requests must be submitted through our online form.")).toContain(
      "email-not-accepted",
    );
    expect(rulesFor("All requests must be made at https://acme.test/optout")).toContain(
      "email-not-accepted",
    );
    expect(
      rulesFor("Requests can only be submitted via our privacy portal at https://acme.test"),
    ).toContain("email-not-accepted");
  });
});

describe("a condition that is only a reference", () => {
  it("still reads a finished removal after a ticket number introduced by in case", () => {
    expect(rulesFor("Regarding your request in case 12345, your data has been deleted.")).toContain(
      "has-been-done",
    );
  });

  it("still voids a finished removal that sits under a real condition", () => {
    expect(rulesFor("In case you ask, your data has been deleted.")).not.toContain("has-been-done");
  });
});

describe("automatic replies", () => {
  const auto = (overrides: Partial<Parameters<typeof matchSignals>[0]["message"]>) =>
    matchSignals({
      message: {
        subject: "Automatic reply: your request",
        from: { name: null, address: "privacy@broker.test" },
        isBounce: false,
        autoSubmitted: false,
        headers: {},
        ...overrides,
      },
      body: "I am out of the office until Monday.",
    });

  it("reads a machine-sent out-of-office notice as a header reading", () => {
    expect(auto({ autoSubmitted: true })[0]).toMatchObject({
      classification: "auto_ack",
      rule: "automatic-reply",
    });
  });

  it("leaves an out-of-office subject with no machine header to a person", () => {
    expect(auto({})[0]).toMatchObject({ classification: "auto_ack", rule: null });
  });

  it("reads a delay notice inside a delivery report as a header reading", () => {
    const delayed = {
      subject: "Delivery Status Notification (Delay)",
      isBounce: true,
    };
    const result = matchSignals({
      message: {
        ...delayed,
        from: { name: null, address: "mailer-daemon@broker.test" },
        autoSubmitted: false,
        headers: {},
      },
      body: "Delivery is delayed; we will keep trying.",
    });
    expect(result[0]).toMatchObject({ classification: "auto_ack", rule: "automatic-reply" });
  });
});

describe("which readings are applied without a person", () => {
  it("applies no wording rule until fresh mail has measured it", () => {
    expect([...PROVEN_RULES]).toEqual([]);
    for (const rule of RULES) expect(appliesWithoutPerson(rule.id)).toBe(false);
  });

  it("names every wording rule once, and every proven one exists", () => {
    const ids = RULES.map((rule) => rule.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of PROVEN_RULES) expect(ids).toContain(id);
  });

  it("applies the header readings and nothing that has no source", () => {
    expect([...STRUCTURAL_READINGS].sort()).toEqual(["automatic-reply", "delivery-report"]);
    expect(appliesWithoutPerson("delivery-report")).toBe(true);
    expect(appliesWithoutPerson("automatic-reply")).toBe(true);
    expect(appliesWithoutPerson("acknowledged")).toBe(false);
    expect(appliesWithoutPerson(null)).toBe(false);
  });

  it("applies a confirmation link only for a request that is waiting for it", () => {
    expect([...WAITING_READINGS]).toEqual(["confirmation-link"]);
    expect(appliesWithoutPerson("confirmation-link")).toBe(false);
    expect(appliesWithoutPerson("confirmation-link", { waiting: true })).toBe(true);
  });
});

describe("a company that only takes requests from the person", () => {
  it("reads a refusal of third-party requests as a redirect to ask again as the person", () => {
    for (const reply of [
      "Thanks for reaching out. We do not process opt-out requests submitted by third parties. The individual can remove their listing at https://example.test/opt-out.",
      "Requests from third parties are not accepted. Please have the person submit the request themselves.",
      "Third-party removal requests cannot be processed. The record owner may contact us directly.",
      "Removal requests must be submitted directly by the individual whose information appears on the site.",
      "We only act on requests that come directly from the consumer.",
    ]) {
      expect(topOf(reply), reply).toMatchObject({
        classification: "needs_form",
        rule: "person-only",
      });
    }
  });

  it("does not read a promise about third parties, or a condition for agents, as a refusal", () => {
    for (const reply of [
      "We never sell your information to third parties, and we have now removed your record.",
      "We do not process data on behalf of third parties, so there is nothing for us to delete.",
      "If you are an authorized agent acting for a consumer, attach the signed permission and we will proceed.",
      "Third parties are not permitted to view your account details.",
    ]) {
      expect(rulesFor(reply), reply).not.toContain("person-only");
    }
  });
});
