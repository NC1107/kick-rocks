import type { TargetOutcome } from "@kickrocks/shared";
import { describe, expect, it } from "vitest";
import {
  advisories,
  channelOf,
  countByChannel,
  countNovelty,
  groupSkipped,
  outcomeChannel,
  parseFilterParam,
  parseTargetIds,
  waitingForPerson,
} from "./channels.js";

const outcome = (
  targetId: string,
  kind: TargetOutcome["outcome"],
  reason: TargetOutcome["reason"] = null,
): TargetOutcome => ({
  targetId,
  targetName: targetId,
  outcome: kind,
  requestId: null,
  scanId: null,
  reason,
  detail: null,
});

describe("channelOf", () => {
  it("starts a site that needs a record from a scan, whatever its contact method", () => {
    expect(channelOf({ needsRecord: true, contactMethod: "both" })).toBe("scan");
  });

  it("emails a target with an address and uses the form otherwise", () => {
    expect(channelOf({ needsRecord: false, contactMethod: "both" })).toBe("email");
    expect(channelOf({ needsRecord: false, contactMethod: "email" })).toBe("email");
    expect(channelOf({ needsRecord: false, contactMethod: "form" })).toBe("form");
    expect(channelOf({ needsRecord: false, contactMethod: "unknown" })).toBeNull();
  });
});

describe("countByChannel", () => {
  const targets = new Map([
    ["a", { needsRecord: false, contactMethod: "email" as const }],
    ["b", { needsRecord: false, contactMethod: "form" as const }],
  ]);

  it("counts each outcome under the channel it uses", () => {
    const counts = countByChannel(
      [
        outcome("a", "request_created"),
        outcome("b", "request_created"),
        outcome("c", "scan_started"),
        outcome("d", "skipped", "already_active"),
      ],
      targets,
    );
    expect(counts).toEqual({ email: 1, form: 1, manual: 0, scan: 1, skipped: 1 });
  });

  it("splits web forms into those a recipe fills in and those left to an agent or the person", () => {
    const withAutomation = new Map([
      [
        "worker",
        {
          needsRecord: false,
          contactMethod: "form" as const,
          automation: { scan: null, remove: "healthy" as const },
        },
      ],
      [
        "none",
        {
          needsRecord: false,
          contactMethod: "form" as const,
          automation: { scan: null, remove: null },
        },
      ],
      [
        "broken",
        {
          needsRecord: false,
          contactMethod: "form" as const,
          automation: { scan: null, remove: "broken" as const },
        },
      ],
    ]);
    const counts = countByChannel(
      [
        outcome("worker", "request_created"),
        outcome("none", "request_created"),
        outcome("broken", "request_created"),
      ],
      withAutomation,
    );
    expect(counts).toMatchObject({ form: 1, manual: 2 });
  });

  it("counts a created request for an unknown target as a form, so the total still adds up", () => {
    const counts = countByChannel([outcome("zzz", "request_created")], targets);
    expect(counts.form).toBe(1);
  });
});

describe("groupSkipped", () => {
  it("groups by reason with the biggest group first and ignores what was not skipped", () => {
    const groups = groupSkipped([
      outcome("a", "skipped", "no_mailbox"),
      outcome("b", "skipped", "already_active"),
      outcome("c", "skipped", "already_active"),
      outcome("d", "request_created"),
    ]);
    expect(groups.map((group) => [group.reason, group.items.length])).toEqual([
      ["already_active", 2],
      ["no_mailbox", 1],
    ]);
  });
});

describe("advisories", () => {
  it("keeps targets that go ahead with a note and drops skips and plain outcomes", () => {
    const noted = { ...outcome("a", "request_created"), detail: "DROP can delete more." };
    const skipped = { ...outcome("b", "skipped", "no_mailbox"), detail: "Connect a mailbox." };
    expect(advisories([noted, skipped, outcome("c", "request_created")])).toEqual([noted]);
  });
});

describe("parseTargetIds", () => {
  it("drops blanks and repeats", () => {
    expect(parseTargetIds("a, b,,a ,c")).toEqual(["a", "b", "c"]);
    expect(parseTargetIds(null)).toEqual([]);
  });
});

describe("outcomeChannel", () => {
  const targets = new Map([["a", { needsRecord: false, contactMethod: "email" as const }]]);

  it("names the readout row of each outcome", () => {
    expect(outcomeChannel(outcome("a", "request_created"), targets)).toBe("email");
    expect(outcomeChannel(outcome("a", "scan_started"), targets)).toBe("scan");
    expect(outcomeChannel(outcome("a", "skipped", "already_active"), targets)).toBe("skipped");
    expect(outcomeChannel(outcome("unknown", "request_created"), targets)).toBe("form");
  });
});

describe("parseFilterParam", () => {
  it("reads a filter a Targets link carries", () => {
    expect(parseFilterParam('{"difficulty":"easy","kind":"broker"}')).toEqual({
      difficulty: "easy",
      kind: "broker",
    });
  });

  it("ignores anything that is not a filter", () => {
    expect(parseFilterParam(null)).toBeNull();
    expect(parseFilterParam("not json")).toBeNull();
    expect(parseFilterParam('{"difficulty":"trivial"}')).toBeNull();
    expect(parseFilterParam('{"unknown":"x"}')).toBeNull();
  });
});

describe("waitingForPerson", () => {
  const counts = { email: 4, form: 2, manual: 3, scan: 1, skipped: 0 };

  it("counts the forms no recipe covers when no agent has been seen", () => {
    expect(waitingForPerson(counts, false)).toBe(3);
  });

  it("stays quiet once an agent has been seen", () => {
    expect(waitingForPerson(counts, true)).toBe(0);
  });
});

describe("countNovelty", () => {
  it("counts what starts as new and only already-in-hand skips as handled", () => {
    const items = [
      outcome("a", "request_created"),
      outcome("b", "scan_started"),
      outcome("c", "skipped", "already_active"),
      outcome("d", "skipped", "already_confirmed"),
      outcome("e", "skipped", "scan_in_progress"),
      outcome("f", "skipped", "no_mailbox"),
    ];
    expect(countNovelty(items)).toEqual({ fresh: 2, handled: 3 });
  });
});
