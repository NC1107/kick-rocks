import type { Paged, RequestDetail, RequestListItem } from "@kickrocks/shared";
import { describe, expect, it } from "vitest";
import {
  detailRefreshInterval,
  listRefreshInterval,
  REFRESH_MS,
  WAITING_REFRESH_MS,
} from "./polling.js";

const page = (...statuses: RequestListItem["status"][]) =>
  ({ items: statuses.map((status) => ({ status })) }) as unknown as Paged<RequestListItem>;
const detail = (status: RequestDetail["status"], tasks: string[] = []) =>
  ({
    status,
    tasks: tasks.map((taskStatus) => ({ status: taskStatus })),
  }) as unknown as RequestDetail;

describe("polling the requests screens", () => {
  it("polls a list fast while any request is going out", () => {
    expect(listRefreshInterval(page("awaiting_reply", "queued"))).toBe(REFRESH_MS);
  });

  it("keeps polling a list that only waits on replies, so a reply shows without a reload", () => {
    expect(listRefreshInterval(page("awaiting_reply", "confirmed"))).toBe(WAITING_REFRESH_MS);
    expect(listRefreshInterval(page("needs_verification"))).toBe(WAITING_REFRESH_MS);
  });

  it("stops polling a list when everything is settled or nothing has loaded", () => {
    expect(listRefreshInterval(page("confirmed", "no_record", "cancelled"))).toBe(false);
    expect(listRefreshInterval(undefined)).toBe(false);
  });

  it("polls a request that is queued or has a live task fast", () => {
    expect(detailRefreshInterval(detail("queued"))).toBe(REFRESH_MS);
    expect(detailRefreshInterval(detail("awaiting_reply", ["leased"]))).toBe(REFRESH_MS);
  });

  it("polls an open request slowly and leaves a settled one alone", () => {
    expect(detailRefreshInterval(detail("awaiting_reply", ["done", "blocked"]))).toBe(
      WAITING_REFRESH_MS,
    );
    expect(detailRefreshInterval(detail("confirmed", ["done"]))).toBe(false);
    expect(detailRefreshInterval(undefined)).toBe(false);
  });
});
