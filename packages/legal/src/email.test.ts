import {
  POLICY_BASIS_ID,
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
  getLegalBasis,
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
      expect(words, label).toBeLessThan(250);
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

  it("asks not to be asked for ID only for an opt-out", () => {
    for (const [label, input] of allInputs) {
      if (input.kind !== "initial") continue;
      const { text } = renderRequestEmail(input);
      expect(text.includes("do not ask for ID"), label).toBe(input.rights.includes("opt_out"));
    }
  });

  it("says an opt-out need not be authenticated only under a rule it can cite", () => {
    const claim = "does not have to be authenticated";
    const texts = (state: Parameters<typeof build>[0]) =>
      renderRequestEmail(build(state, "initial", ["opt_out"])).text;
    const rules = {
      CA: "11 CCR 7026(d)",
      CT: "Conn. Gen. Stat. 42-518(c)(4)",
      DE: "6 Del. C. 12D-104(c)(4)",
      MD: "Md. Code, Com. Law 14-4705(e)(6)",
      MN: "Minn. Stat. 325M.14, subd. 4(h)",
      MT: "Mont. Code Ann. 30-14-2808(4)(d)",
      NH: "N.H. Rev. Stat. Ann. 507-H:4, III(d)",
      NJ: "N.J.S.A. 56:8-166.7(e)",
      OR: "Or. Rev. Stat. 646A.576(5)(e)",
      RI: "R.I. Gen. Laws 6-48.1-6(b)(4)",
    } as const;
    for (const [state, rule] of Object.entries(rules)) {
      const text = texts(state as keyof typeof rules);
      expect(text, state).toContain(`Under ${rule}, an opt-out of sale ${claim}.`);
      expect(text, state).toContain("If you need a detail to find my record, tell me which one.");
    }
    for (const state of [
      "CO",
      "VA",
      "TX",
      "NV",
      "WY",
      "UT",
      "IA",
      "NE",
      "TN",
      "KY",
      "IN",
    ] as const) {
      const text = texts(state);
      expect(text, state).not.toContain(claim);
      expect(text, state).not.toContain("no proof of my identity");
      expect(text, state).toContain("Please do not ask for ID, an account, or a fee");
    }
  });

  it("cites the Alabama and Vermont authentication rules once those laws take effect", () => {
    const claim = "does not have to be authenticated";
    const rules = {
      AL: ["2027-05-01", "Ala. Act 2026-552, sec. 5(d)(4)"],
      VT: ["2028-01-01", "9 V.S.A. 2415d(c)(4)(B)"],
    } as const;
    for (const [state, [effective, rule]] of Object.entries(rules)) {
      const text = (asOf: string) =>
        renderRequestEmail(
          build(state as keyof typeof rules, "initial", ["opt_out"], {
            asOf: new Date(`${asOf}T00:00:00Z`),
          }),
        ).text;
      expect(text(effective), state).toContain(`Under ${rule}, an opt-out of sale ${claim}.`);
      expect(text("2026-10-07"), state).not.toContain(claim);
    }
  });

  it("does not make the authentication claim for the part of a request the statute does not cover", () => {
    const claim = "does not have to be authenticated";
    const deleteOnly = renderRequestEmail(build("CA", "initial", ["delete"])).text;
    expect(deleteOnly).not.toContain(claim);
    expect(deleteOnly).not.toContain("do not ask for ID");
    const policy = getLegalBasis(
      POLICY_BASIS_ID,
      "CA",
      undefined,
      new Date("2026-10-07T12:00:00Z"),
    );
    if (!policy) throw new Error("the policy basis must resolve");
    const policyOptOut = renderRequestEmail({
      ...build("CA", "initial", ["opt_out"]),
      basis: policy,
    });
    expect(policyOptOut.text).not.toContain(claim);
    const bothToBroker = renderRequestEmail(build("CA", "initial", ["opt_out", "delete"])).text;
    expect(bothToBroker).toContain("Under 11 CCR 7026(d), an opt-out of sale");
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
      const optsOutUnderCcpa =
        input.basis.id === "ca-ccpa" && input.rights.every((right) => right === "opt_out");
      expect(renderRequestEmail(input).text, label).toContain(
        optsOutUnderCcpa
          ? "no later than 15 business days after you receive this email"
          : `within ${input.basis.responseDays} days of receiving this email`,
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
    expect(text).not.toContain("opt out of the sale of my personal information");
    expect(text).toContain(
      "for the rest I ask you to honor it under your own published privacy commitments",
    );
  });

  it("does not say the person has a right to email deletion under the Delete Act", () => {
    const text = renderRequestEmail(
      build("CA", "initial", ["delete"], { target: CA_REGISTERED }),
    ).text;
    expect(text).toContain("California Delete Act");
    expect(text).not.toContain("I have the right");
    expect(text).toContain("a data broker registered with the state must process");
  });

  it("cites the statute for the opt-out and policy for deletion in a two-right broker email", () => {
    for (const [state, name] of [
      ["UT", "Utah Consumer Privacy Act"],
      ["IA", "Iowa Consumer Data Protection Act"],
      ["CA", "California Consumer Privacy Act"],
    ] as const) {
      const text = renderRequestEmail(build(state, "initial", ["opt_out", "delete"])).text;
      expect(text, state).toContain(`Under the ${name}`);
      expect(text, state).toContain(
        "I have the right to opt out of the sale of my personal information.",
      );
      expect(text, state).not.toContain("have my personal information deleted");
      expect(text, state).toContain(
        "That law does not cover everything I ask, so for the rest I ask you to honor it under your own published privacy commitments.",
      );
    }
  });

  it("limits a Utah or Iowa deletion right to the data the person provided, for a company", () => {
    for (const state of ["UT", "IA"] as const) {
      const text = renderRequestEmail(
        build(state, "initial", ["delete"], { target: COMPANY }),
      ).text;
      expect(text, state).toContain("have the personal information I provided to you deleted");
      expect(text, state).not.toContain("have my personal information deleted");
    }
  });

  it("asks a statute-basis recipient to name another channel if its privacy notice requires one", () => {
    const channel = "If your privacy notice requires another way to submit this, tell me which.";
    expect(renderRequestEmail(build("OR", "initial", ["opt_out"])).text).toContain(channel);
    expect(renderRequestEmail(build("OR", "follow_up", ["opt_out"])).text).not.toContain(channel);
  });

  it("gives Nevada residents the NRS 603A opt-out, with the 60 day window and no deletion claim", () => {
    const text = renderRequestEmail(build("NV", "initial", ["opt_out", "delete"])).text;
    expect(text).toContain("Nevada Revised Statutes chapter 603A");
    expect(text).toContain("within 60 days of receiving this email");
    expect(text).not.toContain("have my personal information deleted");
  });

  it("leaves out the extension sentence for a California opt-out, which has none", () => {
    const text = renderRequestEmail(build("CA", "initial", ["opt_out"])).text;
    expect(text).toContain("no later than 15 business days");
    expect(text).not.toContain("extra time");
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
