import { RequestStatus } from "@kickrocks/shared";
import { describe, expect, it } from "vitest";
import { STATUS_GROUPS } from "../dashboard/sections.js";
import { groupRequests } from "./sections.js";
import { familyShape, listShape } from "./shape.js";

const items = (...statuses: RequestStatus[]) =>
  statuses.map((status, index) => ({ id: String(index), status }));

describe("grouping requests the way Home does", () => {
  it("uses Home's three groups and their words, with what needs a look first", () => {
    const groups = groupRequests(items("confirmed", "sent", "bounced", "queued"));
    expect(groups.map((group) => [group.label, group.items.length])).toEqual([
      ["Needs a look", 1],
      ["In progress", 2],
      ["Done", 1],
    ]);
  });

  it("places every status in the group Home counts it in", () => {
    for (const status of RequestStatus.options) {
      const [group] = groupRequests(items(status));
      const home = STATUS_GROUPS.find((candidate) => candidate.statuses.includes(status));
      expect(group?.label, status).toBe(home?.title);
    }
  });

  it("drops empty groups and keeps arrival order inside a group", () => {
    expect(groupRequests(items("sent")).map((group) => group.id)).toEqual(["active"]);
    expect(groupRequests([])).toEqual([]);
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
