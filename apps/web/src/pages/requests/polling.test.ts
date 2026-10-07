import type { Paged, RequestDetail, RequestListItem } from "@kickrocks/shared";
import { describe, expect, it } from "vitest";
import { detailRefreshInterval, listRefreshInterval, REFRESH_MS } from "./polling.js";

const page = (...statuses: RequestListItem["status"][]) =>
  ({ items: statuses.map((status) => ({ status })) }) as unknown as Paged<RequestListItem>;
const detail = (status: RequestDetail["status"], tasks: string[] = []) =>
  ({
    status,
    tasks: tasks.map((taskStatus) => ({ status: taskStatus })),
  }) as unknown as RequestDetail;

describe("polling the requests screens", () => {
  it("polls a list while any request has not gone out", () => {
    expect(listRefreshInterval(page("awaiting_reply", "queued"))).toBe(REFRESH_MS);
  });

  it("stops polling a list when nothing is in flight or nothing has loaded", () => {
    expect(listRefreshInterval(page("awaiting_reply", "confirmed"))).toBe(false);
    expect(listRefreshInterval(undefined)).toBe(false);
  });

  it("polls a request that is queued or has a live task", () => {
    expect(detailRefreshInterval(detail("queued"))).toBe(REFRESH_MS);
    expect(detailRefreshInterval(detail("awaiting_reply", ["leased"]))).toBe(REFRESH_MS);
  });

  it("leaves a settled request alone", () => {
    expect(detailRefreshInterval(detail("awaiting_reply", ["done", "blocked"]))).toBe(false);
    expect(detailRefreshInterval(undefined)).toBe(false);
  });
});
