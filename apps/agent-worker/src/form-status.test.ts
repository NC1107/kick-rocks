import { describe, expect, it } from "vitest";
import { ALL_FILLED, emptyControlList, formStatusLine, NO_FIELD_RULE } from "./form-status.js";

describe("the form status line", () => {
  it("says every required control is filled when none is left empty", () => {
    expect(formStatusLine([])).toBe(ALL_FILLED);
    expect(ALL_FILLED).toBe("Every required control in this form is filled.");
  });

  it("lists lists with at most four options, checkboxes and plain controls, then the fixed rule", () => {
    const line = formStatusLine([
      { ref: "e7", label: "Request type", kind: "list", options: ["A", "B", "C", "D", "E"] },
      { ref: "e12", label: "I confirm this request is mine", kind: "checkbox" },
      { ref: "e13", label: "Phone", kind: "text" },
      { ref: "e14", label: "Kind", kind: "choice", options: ["Personal", "Business"] },
      { ref: "e15", label: "Product", kind: "combobox" },
    ]);
    expect(line.split("\n")).toEqual([
      'Still empty and required in this form: [e7] "Request type" (a list: "A", "B", "C", "D", ...), [e12] checkbox "I confirm this request is mine", [e13] "Phone", [e14] "Kind" (a choice: "Personal", "Business"), [e15] "Product" (a list)',
      NO_FIELD_RULE,
    ]);
  });

  it("shows at most five controls and counts the rest", () => {
    const controls = Array.from({ length: 8 }, (_, i) => ({
      ref: `e${i + 1}`,
      label: `Detail ${i + 1}`,
      kind: "text" as const,
    }));
    expect(emptyControlList(controls)).toBe(
      '[e1] "Detail 1", [e2] "Detail 2", [e3] "Detail 3", [e4] "Detail 4", [e5] "Detail 5", and 3 more',
    );
    expect(emptyControlList([])).toBeNull();
  });

  it("cuts a long label", () => {
    const list = emptyControlList([{ ref: "e1", label: "x".repeat(100), kind: "text" }]);
    expect(list).toBe(`[e1] "${"x".repeat(37)}..."`);
  });

  it("states the rule the way the task asks for it", () => {
    expect(NO_FIELD_RULE).toBe(
      "A required control that asks for a detail of the person the task has no field for means report blocked with reason unknown, naming it. A choice that is not about the person, such as which product or which kind of request, is yours: pick the option that fits the task.",
    );
  });
});
