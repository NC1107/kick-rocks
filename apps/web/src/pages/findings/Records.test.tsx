import type { ListingRecord, MatchBand } from "@kickrocks/shared";
import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderPage } from "../../test/render.js";
import { RecordList } from "./Records.js";

function record(
  name: string,
  band: MatchBand,
  decision: ListingRecord["decision"] = "pending",
): ListingRecord {
  return {
    id: `m_${name}`,
    scanId: "s1",
    profileId: "p1",
    targetId: "namelookup",
    targetName: "NameLookup",
    recordUrl: `https://www.namelookup.example/p/${name}`,
    fields: { name, locations: [] },
    assessment: { band, score: 10, reasons: [{ kind: "phone", weight: "strong" }] },
    decision,
    decidedAt: null,
    requestId: null,
    verifiedGoneAt: null,
    request: null,
  };
}

const open = (records: ListingRecord[]) =>
  renderPage(<RecordList records={records} label="Records on NameLookup" />, {
    withProfile: false,
  });

describe("RecordList", () => {
  it("folds and bulk-marks only the unlikely records still waiting for an answer", () => {
    open([
      record("Decided Mine", "unlikely", "mine"),
      record("Decided Not", "unlikely", "not_mine"),
      record("Waiting Unlikely", "unlikely"),
    ]);
    expect(screen.getByRole("button", { name: "1 weak match" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Mark 1 unlikely record as not you" })).toBeVisible();
  });

  it("offers no bulk action when every unlikely record is answered", () => {
    open([record("Decided Mine", "unlikely", "mine"), record("Waiting", "likely")]);
    expect(screen.queryByRole("button", { name: /unlikely/ })).toBeNull();
  });

  it("keeps waiting records ahead of answered ones and shows no score on the answered", () => {
    open([
      record("Answered Likely", "likely", "not_mine"),
      record("Waiting Maybe", "maybe"),
      record("Waiting Likely", "likely"),
    ]);
    const names = screen
      .getAllByRole("listitem")
      .map((item) => within(item).getByText(/^(Waiting|Answered) /).textContent);
    expect(names).toEqual(["Waiting Likely", "Waiting Maybe", "Answered Likely"]);
    const answered = screen.getByRole("list", { name: "Answered records on NameLookup" });
    expect(within(answered).queryByText("Likely")).toBeNull();
  });
});
