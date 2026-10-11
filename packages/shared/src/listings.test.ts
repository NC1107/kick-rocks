import { describe, expect, it } from "vitest";
import {
  DEFAULT_SCAN_PREFERENCE,
  deriveListingStatus,
  LISTING_GROUPS,
  ListingStatus,
  listingGroupOf,
  preferenceBlocks,
  type ScanPreference,
} from "./listings.js";

const TODAY = "2026-10-11";
const finished = { taskStatus: "done", finishedAt: "2026-10-01T00:00:00.000Z", error: null };
const clean = { ...finished, noResultsShown: true };

const record = (decision: "pending" | "mine" | "not_mine", status?: string) => ({
  decision,
  request: status
    ? {
        id: "r",
        status: status as "confirmed",
        reference: "KR-ABCDEF" as const,
        updatedAt: "2026-10-02T00:00:00.000Z",
      }
    : null,
});

const status = (input: Partial<Parameters<typeof deriveListingStatus>[0]>) =>
  deriveListingStatus({
    preference: DEFAULT_SCAN_PREFERENCE,
    today: TODAY,
    scans: [],
    records: [],
    relisted: false,
    ...input,
  });

describe("preferenceBlocks", () => {
  const paused = (pausedUntil: string | null): ScanPreference => ({
    ...DEFAULT_SCAN_PREFERENCE,
    mode: "paused",
    pausedUntil,
  });

  it("holds a pause until its date and lets the site back in on that day", () => {
    expect(preferenceBlocks(paused("2026-10-12"), TODAY)).toBe("site_paused");
    expect(preferenceBlocks(paused("2026-10-11"), TODAY)).toBeNull();
    expect(preferenceBlocks(paused(null), TODAY)).toBe("site_paused");
  });

  it("never lets a skipped site through, and ignores automatic ones", () => {
    expect(preferenceBlocks({ ...DEFAULT_SCAN_PREFERENCE, mode: "skipped" }, TODAY)).toBe(
      "site_skipped",
    );
    expect(preferenceBlocks(DEFAULT_SCAN_PREFERENCE, TODAY)).toBeNull();
  });
});

describe("deriveListingStatus", () => {
  it("is not_scanned with no scan", () => {
    expect(status({})).toBe("not_scanned");
  });

  it("puts a choice first, then what needs an answer", () => {
    const skipped = { ...DEFAULT_SCAN_PREFERENCE, mode: "skipped" as const };
    const paused = { ...DEFAULT_SCAN_PREFERENCE, mode: "paused" as const };
    expect(status({ preference: skipped, records: [record("pending")] })).toBe("skipped");
    expect(status({ preference: paused, records: [record("pending")] })).toBe("to_confirm");
    expect(status({ preference: paused, scans: [clean] })).toBe("paused");
  });

  it("reads a queued scan as waiting, a blocked one as needing a check, and a leased one as scanning", () => {
    expect(status({ scans: [{ ...clean, taskStatus: "queued", finishedAt: null }] })).toBe(
      "waiting",
    );
    expect(status({ scans: [{ ...clean, taskStatus: "blocked", finishedAt: null }] })).toBe(
      "needs_check",
    );
    expect(status({ scans: [{ ...clean, taskStatus: "leased", finishedAt: null }] })).toBe(
      "scanning",
    );
  });

  it("keeps a removal visible while a routine rescan waits", () => {
    const queued = { ...clean, taskStatus: "queued", finishedAt: null };
    expect(status({ scans: [queued, clean], records: [record("mine", "confirmed")] })).toBe(
      "removed",
    );
    expect(status({ scans: [queued, clean], records: [record("mine", "awaiting_reply")] })).toBe(
      "yours",
    );
  });

  it("is removed only when every removal is closed, and relisted when one came back", () => {
    expect(status({ scans: [clean], records: [record("mine", "no_record")] })).toBe("removed");
    expect(
      status({
        scans: [clean],
        records: [record("mine", "confirmed"), record("mine", "queued")],
        relisted: true,
      }),
    ).toBe("relisted");
    expect(
      status({ scans: [clean], records: [record("mine", "confirmed"), record("mine", "queued")] }),
    ).toBe("yours");
  });

  it("sends a removal that ended badly to the person, and keeps one under way as yours", () => {
    for (const ended of ["rejected", "bounced", "no_response", "cancelled"]) {
      expect(status({ scans: [clean], records: [record("mine", ended)] })).toBe("removal_stalled");
    }
    expect(
      status({
        scans: [clean],
        records: [record("mine", "awaiting_reply"), record("mine", "rejected")],
      }),
    ).toBe("removal_stalled");
    for (const active of ["queued", "sent", "awaiting_reply", "follow_up_due"]) {
      expect(status({ scans: [clean], records: [record("mine", active)] })).toBe("yours");
    }
  });

  it("tells not you, not found, unclear and failed apart", () => {
    expect(status({ scans: [clean], records: [record("not_mine")] })).toBe("not_you");
    expect(status({ scans: [clean] })).toBe("not_found");
    expect(status({ scans: [{ ...clean, noResultsShown: false }] })).toBe("unclear");
    expect(status({ scans: [{ ...clean, error: "timed out" }] })).toBe("failed");
  });

  it("ignores a scan withdrawn by a pause", () => {
    const cancelled = { ...clean, taskStatus: "cancelled", error: "Cancelled because you paused" };
    expect(status({ scans: [cancelled] })).toBe("not_scanned");
    expect(status({ scans: [cancelled, clean] })).toBe("not_found");
  });
});

describe("the filter groups", () => {
  it("place every status in exactly one group", () => {
    const placed = Object.values(LISTING_GROUPS).flat();
    expect([...placed].sort()).toEqual([...ListingStatus.options].sort());
    expect(listingGroupOf("relisted")).toBe("yours");
    expect(listingGroupOf("removal_stalled")).toBe("needs_you");
    expect(listingGroupOf("needs_check")).toBe("needs_you");
  });
});
