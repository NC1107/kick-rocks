import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createMockApp } from "../../../mock/app.js";
import { renderPage } from "../../test/render.js";
import { instrument } from "../profiles/test-support.js";
import { Component as DashboardPage } from "./index.js";
import { attentionItems, groupActivity, groupTotal, STATUS_GROUPS } from "./sections.js";

describe("the dashboard", () => {
  it("shows a skeleton shaped like the page while it loads", async () => {
    renderPage(<DashboardPage />, { mockOptions: { latencyMs: 60 } });
    await screen.findByRole("heading", { name: "Dashboard" });
    expect(document.querySelector("[aria-busy=true]")).not.toBeNull();
    expect(await screen.findByRole("heading", { name: "Requests" })).toBeInTheDocument();
    expect(document.querySelector("[aria-busy=true]")).toBeNull();
  });

  it("totals requests into in progress, resolved, and needs a look", async () => {
    const { mock } = renderPage(<DashboardPage />);
    const jordan = mock.store.profiles[0]?.id;
    const own = mock.store.requests.filter((request) => request.profileId === jordan);

    const requests = (await screen.findByRole("heading", { name: "Requests" })).closest(
      "section",
    ) as HTMLElement;
    for (const group of STATUS_GROUPS) {
      const section = within(requests).getByRole("region", { name: group.title });
      const expected = own.filter((request) => group.statuses.includes(request.status)).length;
      expect(within(section).getByText(String(expected), { selector: "p" })).toBeInTheDocument();
    }
  });

  it("links each status to the request list filtered by it", async () => {
    renderPage(<DashboardPage />);
    const confirmed = await screen.findByRole("link", { name: "Confirmed" });
    expect(confirmed).toHaveAttribute("href", "/requests?status=confirmed");
  });

  it("lists what needs the person, each linking to the review queue", async () => {
    renderPage(<DashboardPage />);
    const needs = (await screen.findByRole("heading", { name: "Needs you" })).closest(
      "section",
    ) as HTMLElement;
    const links = within(needs).getAllByRole("link");
    expect(links.length).toBeGreaterThanOrEqual(3);
    for (const link of links) expect(link).toHaveAttribute("href", "/review");
    expect(within(needs).getByText(/Blocked tasks?/)).toBeInTheDocument();
  });

  it("says nothing is waiting when nothing is", async () => {
    const mock = createMockApp();
    mock.store.tasks = [];
    mock.store.matches = [];
    mock.store.messages = [];
    for (const request of mock.store.requests) {
      if (request.status === "needs_verification") request.status = "awaiting_reply";
    }
    renderPage(<DashboardPage />, { mock });
    expect(await screen.findByText("Nothing is waiting on you.")).toBeInTheDocument();
  });

  it("shows the sending meter against the daily limit", async () => {
    renderPage(<DashboardPage />);
    const meter = await screen.findByRole("progressbar", { name: "Daily sending limit used" });
    expect(meter).toHaveAttribute("aria-valuemax", "150");
    expect(Number(meter.getAttribute("aria-valuenow"))).toBeGreaterThanOrEqual(0);
    expect(screen.getByText(/left$/)).toBeInTheDocument();
    expect(screen.getByText(/Inbox checked/)).toBeInTheDocument();
  });

  it("explains when the limit is used up", async () => {
    const mock = createMockApp();
    const mailbox = mock.store.profiles[0]?.mailbox;
    if (mailbox) mailbox.dailyCap = 1;
    const sentToday = mock.store.requests.filter(
      (request) =>
        request.channel === "email" &&
        request.sentAt &&
        Date.parse(request.sentAt) > Date.now() - 86_400_000,
    );
    expect(sentToday.length).toBeGreaterThan(0);
    renderPage(<DashboardPage />, { mock });
    expect(await screen.findByText(/At the limit/)).toBeInTheDocument();
    expect(screen.getByText("0 left")).toBeInTheDocument();
  });

  it("describes recent activity in sentences with the broker and reference", async () => {
    renderPage(<DashboardPage />);
    const activity = (await screen.findByRole("heading", { name: "Recent activity" })).closest(
      "section",
    ) as HTMLElement;
    const items = within(activity).getAllByRole("listitem");
    expect(items.length).toBeGreaterThan(3);
    const first = items[0] as HTMLElement;
    expect(within(first).getByRole("link")).toHaveAttribute(
      "href",
      expect.stringMatching(/^\/requests\/req_/),
    );
    expect(first).toHaveTextContent(/KR-[0-9A-Z]{6}/);
    expect(first.textContent).not.toMatch(/\bundefined\b|\[object/);
  });

  it("warns when no mailbox is connected, with the way to connect one", async () => {
    const mock = createMockApp();
    const riley = mock.store.profiles[1];
    if (!riley) throw new Error("fixture");
    localStorage.setItem("kickrocks.profileId", riley.id);
    renderPage(<DashboardPage />, { mock });
    const notice = await screen.findByText("No mailbox connected");
    expect(notice.closest("[role=alert]")).toHaveTextContent(/wait in the queue/);
    expect(screen.getByRole("link", { name: "Connect a mailbox" })).toHaveAttribute(
      "href",
      `/profiles/${riley.id}/mailbox`,
    );
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("starts a new person at the first step: connect a mailbox", async () => {
    const mock = createMockApp();
    const newcomer = mock.store.profiles[2];
    if (!newcomer) throw new Error("fixture");
    localStorage.setItem("kickrocks.profileId", newcomer.id);
    renderPage(<DashboardPage />, { mock });
    expect(await screen.findByText("No requests yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Connect a mailbox" })).toHaveAttribute(
      "href",
      `/profiles/${newcomer.id}/mailbox`,
    );
    expect(screen.getByRole("link", { name: "Start a campaign" })).toHaveAttribute(
      "href",
      "/campaigns/new",
    );
    expect(screen.queryByText("No mailbox connected")).toBeNull();
  });

  it("makes starting a campaign the main action once a mailbox is connected", async () => {
    const mock = createMockApp();
    mock.store.requests = [];
    renderPage(<DashboardPage />, { mock });
    expect(await screen.findByText("No requests yet")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Connect a mailbox" })).toBeNull();
    expect(screen.getAllByRole("link", { name: /campaign/i }).length).toBeGreaterThan(0);
  });

  it("shows a mailbox error with the link to fix it", async () => {
    const mock = createMockApp();
    const mailbox = mock.store.profiles[0]?.mailbox;
    if (mailbox) mailbox.lastError = "Login failed: invalid credentials.";
    renderPage(<DashboardPage />, { mock });
    const alert = await screen.findByText("The mailbox is not working");
    expect(alert.closest("[role=alert]")).toHaveTextContent("Login failed: invalid credentials.");
    expect(screen.getByRole("link", { name: "Check mailbox" })).toBeInTheDocument();
  });

  it("offers a retry when the dashboard cannot load", async () => {
    const mock = createMockApp();
    instrument(mock, {
      match: "GET /api/profiles/prf_0001/dashboard",
      status: 403,
      body: { error: "forbidden", message: "That request was blocked." },
    });
    renderPage(<DashboardPage />, { mock });
    expect(await screen.findByText("Could not load the dashboard")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("asks for a profile when there are none", async () => {
    const mock = createMockApp();
    mock.store.profiles.length = 0;
    renderPage(<DashboardPage />, { mock });
    expect(await screen.findByText("Create a profile first")).toBeInTheDocument();
  });
});

describe("dashboard helpers", () => {
  it("covers every request status in exactly one group", () => {
    const all = STATUS_GROUPS.flatMap((group) => group.statuses);
    expect(new Set(all).size).toBe(all.length);
    expect(all).toHaveLength(12);
  });

  it("adds a group's counts, treating a missing status as zero", () => {
    expect(groupTotal({ queued: 2, sent: 3 }, ["queued", "sent", "draft"])).toBe(5);
  });

  it("drops attention items that are zero and uses the singular for one", () => {
    const items = attentionItems({
      blockedTasks: 1,
      pendingMatches: 0,
      unreviewedMessages: 2,
      needsVerification: 0,
      failedTasks: 0,
      agentTasks: 0,
    });
    expect(items.map((item) => item.title)).toEqual(["Blocked task", "Replies to sort"]);
  });

  it("lists tasks waiting for an agent", () => {
    const items = attentionItems({
      blockedTasks: 0,
      pendingMatches: 0,
      unreviewedMessages: 0,
      needsVerification: 0,
      failedTasks: 0,
      agentTasks: 3,
    });
    expect(items.map((item) => [item.count, item.title])).toEqual([
      [3, "Tasks waiting for an agent"],
    ]);
  });
});

describe("groupActivity", () => {
  const event = (id: string, requestId: string, createdAt: string) =>
    ({ id, requestId, createdAt }) as never;

  it("folds all events of one request into a count, even when not adjacent", () => {
    const groups = groupActivity([
      event("e1", "r1", "2026-10-07T10:00:00Z"),
      event("e2", "r1", "2026-10-07T09:00:00Z"),
      event("e3", "r1", "2026-10-07T08:00:00Z"),
      event("e4", "r2", "2026-10-07T07:00:00Z"),
      event("e5", "r1", "2026-10-07T06:00:00Z"),
    ]);
    expect(groups.map((g) => [g.latest.id, g.count])).toEqual([
      ["e1", 4],
      ["e4", 1],
    ]);
  });

  it("keeps only the newest few requests", () => {
    const events = Array.from({ length: 10 }, (_, i) =>
      event(`e${i}`, `r${i}`, "2026-10-07T10:00:00Z"),
    );
    expect(groupActivity(events)).toHaveLength(6);
    expect(groupActivity(events, 3)).toHaveLength(3);
  });
});

describe("recent activity on the page", () => {
  it("shows a count when a request repeats", async () => {
    const mock = createMockApp();
    const base = mock.store.requests[0];
    if (!base) throw new Error("fixture");
    renderPage(<DashboardPage />, { mock });
    const activity = (await screen.findByRole("heading", { name: "Recent activity" })).closest(
      "section",
    ) as HTMLElement;
    const requestIds = within(activity)
      .getAllByRole("link")
      .map((link) => link.getAttribute("href"));
    expect(new Set(requestIds).size).toBeGreaterThan(1);
  });
});
