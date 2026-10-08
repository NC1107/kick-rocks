import { describe, expect, it } from "vitest";
import { type KnownRecord, resolveRecordEntry } from "./record-links.js";

const KNOWN: KnownRecord[] = [
  { address: "https://x.test/profile/abc123", shown: "https://x.test/profile/abc123" },
  { address: "https://x.test/profile/abd456", shown: "https://x.test/profile/abd456" },
  { address: "https://x.test/a/dup77", shown: "https://x.test/a/dup77" },
  { address: "https://x.test/b/dup77", shown: "https://x.test/b/dup77" },
  {
    address: "https://x.test/people/jordan-example-77",
    shown: "https://x.test/people/{{first_name}}-{{last_name}}-77",
  },
];
const REFS = new Map([
  ["e12", "https://x.test/profile/abc123"],
  ["e13", "https://x.test/results?page=2"],
]);

function resolve(entry: string) {
  return resolveRecordEntry(entry, KNOWN, REFS);
}

describe("which record an entry of a report names", () => {
  it("takes the whole link, with or without a fragment, a trailing slash, quotes or brackets", () => {
    for (const entry of [
      "https://x.test/profile/abc123",
      "https://x.test/profile/abc123/",
      "https://x.test/profile/abc123#top",
      '"https://x.test/profile/abc123"',
      "<https://x.test/profile/abc123>",
    ]) {
      expect(resolve(entry), entry).toEqual({ address: "https://x.test/profile/abc123" });
    }
  });

  it("takes the path, and the path as the model was shown it", () => {
    expect(resolve("/profile/abc123")).toEqual({ address: "https://x.test/profile/abc123" });
    expect(resolve("/people/{{first_name}}-{{last_name}}-77")).toEqual({
      address: "https://x.test/people/jordan-example-77",
    });
    expect(resolve("https://x.test/people/{{first_name}}-{{last_name}}-77")).toEqual({
      address: "https://x.test/people/jordan-example-77",
    });
  });

  it("takes a unique tail of the link", () => {
    expect(resolve("abc123")).toEqual({ address: "https://x.test/profile/abc123" });
    expect(resolve("profile/abd456")).toEqual({ address: "https://x.test/profile/abd456" });
  });

  it("refuses a tail that fits two records, and one that fits none or is too short", () => {
    expect(resolve("/profile/ab")).toEqual({ problem: "unknown" });
    expect(resolve("dup77")).toEqual({ problem: "ambiguous" });
    expect(resolve("/a/dup77")).toEqual({ address: "https://x.test/a/dup77" });
    expect(resolve("/profile/zzz999")).toEqual({ problem: "unknown" });
    expect(resolve("bc1")).toEqual({ problem: "unknown" });
    expect(resolve("")).toEqual({ problem: "unknown" });
  });

  it("takes a ref of the latest snapshot that leads to a record, and only that", () => {
    expect(resolve("e12")).toEqual({ address: "https://x.test/profile/abc123" });
    expect(resolve("[e12]")).toEqual({ address: "https://x.test/profile/abc123" });
    expect(resolve("e13")).toEqual({ problem: "unknown" });
    expect(resolve("e99")).toEqual({ problem: "unknown" });
  });
});
