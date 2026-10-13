import { RequestStatus } from "@kickrocks/shared";
import { describe, expect, it } from "vitest";
import { familyShape, groupRequests, listShape, sectionOf } from "./grouping.js";

const items = (...statuses: RequestStatus[]) =>
  statuses.map((status, index) => ({ id: String(index), status }));

describe("grouping requests into three sections", () => {
  it("puts what needs a decision first, including bounced and rejected", () => {
    for (const status of [
      "needs_verification",
      "follow_up_due",
      "no_response",
      "bounced",
      "rejected",
    ] as const) {
      expect(sectionOf(status), status).toBe("needs");
    }
  });

  it("keeps waiting requests in progress and finished ones done", () => {
    for (const status of ["draft", "queued", "sent", "awaiting_reply"] as const) {
      expect(sectionOf(status), status).toBe("progress");
    }
    for (const status of ["confirmed", "no_record", "cancelled"] as const) {
      expect(sectionOf(status), status).toBe("done");
    }
  });

  it("places every status in exactly one section", () => {
    for (const status of RequestStatus.options) {
      expect(["needs", "progress", "done"]).toContain(sectionOf(status));
    }
  });

  it("orders the sections Needs you, In progress, Done and drops empty ones", () => {
    const groups = groupRequests(items("confirmed", "sent", "bounced", "queued"));
    expect(groups.map((group) => [group.label, group.items.length])).toEqual([
      ["Needs you", 1],
      ["In progress", 2],
      ["Done", 1],
    ]);
    expect(groupRequests(items("sent")).map((group) => group.id)).toEqual(["progress"]);
    expect(groupRequests([])).toEqual([]);
  });

  it("keeps the order requests arrived in within a section", () => {
    const [group] = groupRequests(items("sent", "queued", "draft"));
    expect(group?.items.map((item) => item.status)).toEqual(["sent", "queued", "draft"]);
  });
});

describe("the list's status shapes", () => {
  it("uses only a ring, a disc, a triangle and a square", () => {
    const shapes = new Set(RequestStatus.options.map(listShape));
    expect([...shapes].sort()).toEqual(["disc", "ring", "square", "triangle"]);
  });

  it("maps each family to its one shape", () => {
    expect(familyShape("progress")).toBe("ring");
    expect(familyShape("closed")).toBe("ring");
    expect(familyShape("resolved")).toBe("disc");
    expect(familyShape("needs")).toBe("triangle");
    expect(familyShape("failed")).toBe("square");
  });
});
