import {
  type ProfileField,
  parseReferences,
  type RequestRight,
  US_STATES,
} from "@kickrocks/shared";
import { describe, expect, it } from "vitest";
import {
  CA_REGISTERED,
  COMPANY,
  jordan,
  makeTarget,
  PEOPLE_SEARCH,
  REFERENCE,
  SENDER,
} from "./fixtures.js";
import {
  identifiersFor,
  LegalInputError,
  type RenderRequestEmailInput,
  renderRequestEmail,
  resolveLegalBasis,
} from "./index.js";

const EM_DASH = String.fromCharCode(0x2014);
const AS_OF = new Date("2026-10-07T12:00:00Z");
const LATE = new Date("2028-06-01T00:00:00Z");
const RIGHT_SETS: Record<string, RequestRight[]> = {
  "opt-out": ["opt_out"],
  delete: ["delete"],
  both: ["opt_out", "delete"],
};
const VERIFICATION_FIELDS: ProfileField[] = ["date_of_birth", "street"];

function build(
  state: Parameters<typeof resolveLegalBasis>[0]["state"],
  kind: RenderRequestEmailInput["kind"],
  rights: RequestRight[],
  options: { target?: ReturnType<typeof makeTarget>; asOf?: Date } = {},
): RenderRequestEmailInput {
  const target = options.target ?? makeTarget();
  const asOf = options.asOf ?? AS_OF;
  const requestedFields = kind === "verification_reply" ? VERIFICATION_FIELDS : [];
  return {
    kind,
    rights,
    reference: REFERENCE,
    basis: resolveLegalBasis({ state, target, rights, asOf }),
    target,
    sender: SENDER,
    identifiers: identifiersFor(target, jordan(), "email", requestedFields, asOf),
    ...(kind === "follow_up"
      ? { followUp: { number: 2, originalSentAt: "2026-08-20T14:03:00.000Z" } }
      : {}),
    ...(kind === "verification_reply" ? { verification: { requestedFields } } : {}),
  };
}

function render(input: RenderRequestEmailInput): string {
  const { subject, text } = renderRequestEmail(input);
  return `Subject: ${subject}\n\n${text}`;
}

describe("renderRequestEmail snapshots", () => {
  for (const { code, name } of US_STATES) {
    for (const kind of ["initial", "follow_up", "verification_reply"] as const) {
      for (const [label, rights] of Object.entries(RIGHT_SETS)) {
        it(`${code} ${name}, ${kind}, ${label}`, () => {
          expect(render(build(code, kind, rights))).toMatchSnapshot();
        });
      }
    }
  }

  for (const state of ["AL", "LA", "OK", "VT"] as const) {
    for (const kind of ["initial", "follow_up", "verification_reply"] as const) {
      for (const [label, rights] of Object.entries(RIGHT_SETS)) {
        it(`${state} once its law is in effect, ${kind}, ${label}`, () => {
          expect(render(build(state, kind, rights, { asOf: LATE }))).toMatchSnapshot();
        });
      }
    }
  }

  const targets = {
    "people-search": PEOPLE_SEARCH,
    company: COMPANY,
    "registered broker": CA_REGISTERED,
  };
  for (const [label, target] of Object.entries(targets)) {
    for (const kind of ["initial", "follow_up", "verification_reply"] as const) {
      for (const state of ["CA", "TX", "WY"] as const) {
        it(`${label} target in ${state}, ${kind}, both rights`, () => {
          expect(
            render(build(state, kind, RIGHT_SETS.both as RequestRight[], { target })),
          ).toMatchSnapshot();
        });
      }
    }
  }

  it("California registered broker, deletion only, cites the Delete Act", () => {
    expect(render(build("CA", "initial", ["delete"], { target: CA_REGISTERED }))).toMatchSnapshot();
  });
});

describe("renderRequestEmail properties", () => {
  const allInputs: [string, RenderRequestEmailInput][] = [];
  for (const { code } of US_STATES) {
    for (const kind of ["initial", "follow_up", "verification_reply"] as const) {
      for (const [label, rights] of Object.entries(RIGHT_SETS)) {
        allInputs.push([`${code} ${kind} ${label}`, build(code, kind, rights, { asOf: LATE })]);
      }
    }
  }

  it("puts exactly one reference in the subject and nothing that matches another in the body", () => {
    for (const [label, input] of allInputs) {
      const { subject, text } = renderRequestEmail(input);
      expect(parseReferences(subject), label).toEqual([REFERENCE]);
      expect(new Set(parseReferences(text)), label).toEqual(new Set([REFERENCE]));
    }
  });

  it("is plain text with no em dash, exclamation mark, emoji, or threat", () => {
    for (const [label, input] of allInputs) {
      const { subject, text } = renderRequestEmail(input);
      const all = `${subject}\n${text}`;
      expect(all, label).not.toContain(EM_DASH);
      expect(all, label).not.toContain("!");
      expect(all, label).not.toMatch(/\p{Extended_Pictographic}/u);
      expect(all, label).not.toMatch(/\b(sue|lawsuit|penalt|fine[sd]?|attorney general|violat)/i);
      expect(subject, label).not.toMatch(/[\r\n]/);
      expect(text.endsWith("\n"), label).toBe(true);
    }
  });

  it("stays short enough to read in a minute", () => {
    for (const [label, input] of allInputs) {
      const words = renderRequestEmail(input).text.split(/\s+/).length;
      expect(words, label).toBeLessThan(230);
    }
  });

  it("asks for what the rights say and nothing else", () => {
    for (const [label, input] of allInputs) {
      const { text } = renderRequestEmail(input);
      expect(/stop selling or sharing/.test(text), label).toBe(input.rights.includes("opt_out"));
      expect(/delete the personal information/.test(text), label).toBe(
        input.rights.includes("delete"),
      );
    }
  });

  it("states the no-verification ask only for an opt-out", () => {
    for (const [label, input] of allInputs) {
      if (input.kind !== "initial") continue;
      const { text } = renderRequestEmail(input);
      expect(text.includes("does not need proof of my identity"), label).toBe(
        input.rights.includes("opt_out"),
      );
    }
  });

  it("cites the statute named by the basis, with its citation, and never one it was not given", () => {
    for (const [label, input] of allInputs) {
      const { text } = renderRequestEmail(input);
      const statute = input.basis.statute;
      if (statute) {
        expect(text, label).toContain(statute.name);
        expect(text, label).toContain(statute.citation);
      } else {
        expect(text, label).toContain("published privacy commitments");
        expect(text, label).not.toMatch(/\bAct\b/);
      }
    }
  });

  it("asks for a written answer inside the basis's response period", () => {
    const initial = allInputs.filter(([, input]) => input.kind === "initial");
    for (const [label, input] of initial) {
      expect(renderRequestEmail(input).text, label).toContain(
        `within ${input.basis.responseDays} days of receiving this email`,
      );
    }
    const iowa = build("IA", "initial", ["opt_out"], { asOf: LATE });
    expect(renderRequestEmail(iowa).text).toContain("within 90 days");
  });

  it("mentions the extension only where the statute has one", () => {
    const texas = renderRequestEmail(build("TX", "initial", ["opt_out"])).text;
    expect(texas).toContain("extra time the law allows");
    const policy = renderRequestEmail(build("WY", "initial", ["opt_out"])).text;
    expect(policy).not.toContain("extra time");
    const deleteAct = renderRequestEmail(
      build("CA", "initial", ["delete"], { target: CA_REGISTERED }),
    ).text;
    expect(deleteAct).not.toContain("extra time");
  });

  it("discloses only the identifiers it is given", () => {
    const text = renderRequestEmail(build("TX", "initial", ["delete"])).text;
    expect(text).toContain("Name: Jordan Q Example");
    expect(text).toContain("Email: jordan@example.org");
    for (const hidden of [
      "Date of birth",
      "Street address",
      "Phone",
      "ZIP",
      "1990",
      "Example Street",
    ]) {
      expect(text).not.toContain(hidden);
    }
  });

  it("puts the requested fields first in a verification reply", () => {
    const text = renderRequestEmail(build("TX", "verification_reply", ["delete"])).text;
    expect(text).toContain("Date of birth: 1990-04-02");
    expect(text).toContain("Street address: 12 Example Street 4B");
    expect(text.indexOf("Street address")).toBeLessThan(text.indexOf("Name: Jordan"));
  });

  it("names the date and number of a follow-up", () => {
    const { subject, text } = renderRequestEmail(build("TX", "follow_up", ["delete"]));
    expect(subject).toBe("Follow-up 2: Deletion request (KR-7K3M9Q)");
    expect(text).toContain("On 2026-08-20 I sent you a request");
    expect(text).toContain("This is follow-up 2.");
  });

  it("uses the subject lines the inbox matcher can read back", () => {
    expect(renderRequestEmail(build("TX", "initial", ["opt_out"])).subject).toBe(
      "Opt-out request (KR-7K3M9Q)",
    );
    expect(renderRequestEmail(build("TX", "initial", ["opt_out", "delete"])).subject).toBe(
      "Opt-out and deletion request (KR-7K3M9Q)",
    );
    expect(renderRequestEmail(build("TX", "verification_reply", ["delete"])).subject).toBe(
      "Re: Deletion request (KR-7K3M9Q)",
    );
  });
});

describe("renderRequestEmail robustness", () => {
  it("renders the same email for rights in any order", () => {
    const a = build("TX", "initial", ["opt_out", "delete"]);
    const b = build("TX", "initial", ["delete", "opt_out"]);
    expect(renderRequestEmail(b)).toEqual(renderRequestEmail(a));
  });

  it("asks under the business's own policy for a right the stored statute does not cover", () => {
    const input = build("CA", "initial", ["delete"], { target: CA_REGISTERED });
    const widened = { ...input, rights: ["opt_out", "delete"] as RequestRight[] };
    const text = renderRequestEmail(widened).text;
    expect(text).toContain("have my personal information deleted");
    expect(text).not.toContain("opt out of the sale of my personal information");
    expect(text).toContain(
      "for the rest I ask you to honor it under your own published privacy commitments",
    );
  });

  it("collapses line breaks in names so a value cannot add lines or headers", () => {
    const input = build("TX", "initial", ["delete"]);
    const hostile = {
      ...input,
      target: { ...input.target, name: "Acme\r\nBcc: someone@example.org" },
      sender: { name: "Jordan\nExample", address: "jordan@example.org" },
      identifiers: { full_name: "Jordan\nBcc: x@example.org", email: "jordan@example.org" },
    };
    const { subject, text } = renderRequestEmail(hostile);
    expect(subject).not.toMatch(/[\r\n]/);
    expect(text).toContain("Hello Acme Bcc: someone@example.org privacy team,");
    expect(text).toContain("Name: Jordan Bcc: x@example.org");
    expect(text).toContain("Thank you,\nJordan Example\njordan@example.org");
  });

  it("falls back to the sender's name and address when no identifiers were chosen", () => {
    const text = renderRequestEmail({
      ...build("TX", "initial", ["delete"]),
      identifiers: {},
    }).text;
    expect(text).toContain("Name: Jordan Q Example");
    expect(text).toContain("Email: jordan@example.org");
  });

  it("rejects a follow-up with no details, a bad date, or a bad number", () => {
    const base = build("TX", "follow_up", ["delete"]);
    const { followUp: _omit, ...without } = base;
    expect(() => renderRequestEmail(without)).toThrow(LegalInputError);
    expect(() =>
      renderRequestEmail({ ...base, followUp: { number: 1, originalSentAt: "yesterday" } }),
    ).toThrow(LegalInputError);
    expect(() =>
      renderRequestEmail({
        ...base,
        followUp: { number: 0, originalSentAt: "2026-08-20T00:00:00Z" },
      }),
    ).toThrow(LegalInputError);
  });

  it("rejects a verification reply with no fields, or fields it has no value for", () => {
    const base = build("TX", "verification_reply", ["delete"]);
    const { verification: _omit, ...without } = base;
    expect(() => renderRequestEmail(without)).toThrow(LegalInputError);
    expect(() => renderRequestEmail({ ...base, verification: { requestedFields: [] } })).toThrow(
      LegalInputError,
    );
    expect(() =>
      renderRequestEmail({ ...base, verification: { requestedFields: ["phone"] } }),
    ).toThrow(/phone/);
  });

  it("rejects bad references, senders, rights, and kinds", () => {
    const base = build("TX", "initial", ["delete"]);
    expect(() => renderRequestEmail({ ...base, reference: "KR-12" as never })).toThrow(
      LegalInputError,
    );
    expect(() =>
      renderRequestEmail({ ...base, sender: { name: " ", address: "jordan@example.org" } }),
    ).toThrow(LegalInputError);
    expect(() =>
      renderRequestEmail({ ...base, sender: { name: "Jordan", address: "nope" } }),
    ).toThrow(LegalInputError);
    expect(() => renderRequestEmail({ ...base, rights: [] })).toThrow(LegalInputError);
    expect(() => renderRequestEmail({ ...base, kind: "reminder" as never })).toThrow(
      LegalInputError,
    );
    expect(() => renderRequestEmail({ ...base, target: { ...base.target, name: "" } })).toThrow(
      LegalInputError,
    );
  });

  it("rejects a statute basis that carries no statute", () => {
    const base = build("TX", "initial", ["delete"]);
    expect(() => renderRequestEmail({ ...base, basis: { ...base.basis, statute: null } })).toThrow(
      LegalInputError,
    );
  });
});
