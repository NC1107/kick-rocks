import { describe, expect, it } from "vitest";
import { hintFor, isPlaceholderEntry, repairReport, senderDomain } from "./near-miss.js";

describe("senderDomain", () => {
  it("reduces an address to its domain and a link to its host", () => {
    expect(senderDomain("noreply@mail.records.test")).toEqual({ domain: "mail.records.test" });
    expect(senderDomain("Records <noreply@Mail.Records.test>")).toEqual({
      domain: "mail.records.test",
    });
    expect(senderDomain("https://mail.records.test/confirm?x=1")).toEqual({
      domain: "mail.records.test",
    });
    expect(senderDomain("mail.records.test")).toEqual({ domain: "mail.records.test" });
  });

  it("treats empty, none and N/A as absent", () => {
    for (const none of ["", "  ", "none", "None", "N/A", "n/a", "null"]) {
      expect(senderDomain(none), none).toEqual({});
    }
  });

  it("hands back words that are no domain, to be kept in the notes", () => {
    expect(senderDomain("the broker's mail server")).toEqual({
      leftover: "the broker's mail server",
    });
  });
});

describe("isPlaceholderEntry", () => {
  it("knows an entry that says there is nothing", () => {
    for (const entry of ["none listed", "None", "N/A", "unknown", "-", "", "not listed"]) {
      expect(isPlaceholderEntry(entry), entry).toBe(true);
    }
    expect(isPlaceholderEntry("Dana Example")).toBe(false);
  });
});

function complete(result: unknown) {
  return { status: "complete", result };
}

function formOf(report: unknown): Record<string, unknown> {
  return (report as { result: { form: Record<string, unknown> } }).result.form;
}

describe("repairReport on a removal", () => {
  const form = (extra: Record<string, unknown>) =>
    complete({ purpose: "remove", form: { outcome: "submitted", ...extra } });

  it("drops an empty or none confirmationFrom and reduces an email address to its domain", () => {
    expect(formOf(repairReport(form({ confirmationFrom: "" })))).toEqual({ outcome: "submitted" });
    expect(formOf(repairReport(form({ confirmationFrom: "none" })))).toEqual({
      outcome: "submitted",
    });
    expect(formOf(repairReport(form({ confirmationFrom: "a@sister.test" })))).toEqual({
      outcome: "submitted",
      confirmationFrom: "sister.test",
    });
  });

  it("keeps words that are no domain in the notes", () => {
    expect(formOf(repairReport(form({ confirmationFrom: "an email", notes: "Sent." })))).toEqual({
      outcome: "submitted",
      notes: "Sent. Confirmation sender: an email",
    });
  });
});

describe("repairReport on a scan", () => {
  const scan = (candidate: Record<string, unknown>) =>
    complete({ purpose: "scan", scan: { candidates: [candidate] } });
  const candidateOf = (report: unknown) =>
    (report as { result: { scan: { candidates: Record<string, unknown>[] } } }).result.scan
      .candidates[0];

  it("turns a locations string into a list and joins nested lists", () => {
    expect(candidateOf(repairReport(scan({ locations: "Austin, TX" })))?.locations).toEqual([
      "Austin, TX",
    ]);
    expect(
      candidateOf(repairReport(scan({ locations: [["Austin", "TX"], "Dallas, TX"] })))?.locations,
    ).toEqual(["Austin, TX", "Dallas, TX"]);
  });

  it("drops placeholder entries from relatives, phones and emails only", () => {
    const candidate = candidateOf(
      repairReport(
        scan({
          locations: ["none listed"],
          relatives: ["none listed", "Dana Example"],
          phones: ["N/A"],
          emails: ["none"],
        }),
      ),
    );
    expect(candidate).toMatchObject({
      locations: ["none listed"],
      relatives: ["Dana Example"],
      phones: [],
      emails: [],
    });
  });
});

describe("repairReport on a block", () => {
  it("maps a reason outside the list to unknown and keeps the model's word", () => {
    expect(
      repairReport({ status: "blocked", reason: "needs_phone", detail: "wants a mobile number" }),
    ).toEqual({
      status: "blocked",
      reason: "unknown",
      detail: "needs_phone: wants a mobile number",
    });
    expect(repairReport({ status: "blocked", reason: "tired" })).toMatchObject({
      reason: "unknown",
      detail: "tired",
    });
  });

  it("leaves a real reason, and the reasons only the worker may give, to the strict schema", () => {
    for (const reason of ["captcha", "approval_needed", "unapproved_submit"]) {
      expect(repairReport({ status: "blocked", reason, detail: "x" })).toEqual({
        status: "blocked",
        reason,
        detail: "x",
      });
    }
  });

  it("passes anything else through", () => {
    expect(repairReport({ status: "release" })).toEqual({ status: "release" });
    expect(repairReport("text")).toBe("text");
  });
});

describe("hintFor", () => {
  it("says what to change instead of quoting a pattern", () => {
    expect(
      hintFor(["result", "form", "confirmationFrom"], "Invalid string: must match pattern"),
    ).toBe("confirmationFrom must be a bare domain such as example.com, or left out");
    expect(hintFor(["locations"], "Invalid input")).toContain("list of strings");
    expect(hintFor(["name"], "Too small")).toBe("Too small");
  });
});
