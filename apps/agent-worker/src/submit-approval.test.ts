import { describe, expect, it } from "vitest";
import { type ControlFacts, mayBeTheSubmit } from "./submit-approval.js";

const control = (overrides: Partial<ControlFacts>): ControlFacts => ({
  tag: "button",
  type: "",
  role: "",
  label: "Accept all cookies",
  ...overrides,
});

describe("which click may send the form", () => {
  it("lets a button that says nothing about sending through before any detail is entered", () => {
    expect(mayBeTheSubmit(control({}), 0)).toBe(false);
  });

  it("stops any button once a detail has been entered", () => {
    expect(mayBeTheSubmit(control({}), 1)).toBe(true);
    expect(mayBeTheSubmit(control({ tag: "input", type: "button", label: "Go" }), 2)).toBe(true);
    expect(mayBeTheSubmit(control({ tag: "div", role: "button", label: "Go" }), 1)).toBe(true);
  });

  it("stops a submit button, or one that offers to send, before anything is typed", () => {
    expect(mayBeTheSubmit(control({ type: "submit", label: "Go" }), 0)).toBe(true);
    expect(mayBeTheSubmit(control({ label: "Remove my listing" }), 0)).toBe(true);
    expect(mayBeTheSubmit(control({ label: "Opt out" }), 0)).toBe(true);
    expect(mayBeTheSubmit(control({ tag: "input", type: "submit", label: "Go" }), 0)).toBe(true);
  });

  it("leaves a link alone unless its words offer to send something", () => {
    expect(mayBeTheSubmit(control({ tag: "a", label: "Privacy policy" }), 3)).toBe(false);
    expect(mayBeTheSubmit(control({ tag: "a", label: "Submit your request" }), 0)).toBe(true);
  });

  it("does not treat a text box or a checkbox as a submit", () => {
    expect(mayBeTheSubmit(control({ tag: "input", type: "text", label: "Submit" }), 2)).toBe(false);
    expect(mayBeTheSubmit(control({ tag: "input", type: "checkbox", label: "" }), 2)).toBe(false);
  });
});
