import { listingRollup, reviewAttention } from "@kickrocks/shared";
import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createMockApp } from "../../../mock/app.js";
import { buildMockListings, summarizeMockListings } from "../../../mock/listings.js";
import { buildMockNeedsYou, buildMockQueue } from "../../../mock/review.js";
import { needsYouTotal } from "../../api/index.js";
import { SidebarContent } from "../../components/layout/Sidebar.js";
import { renderPage } from "../../test/render.js";
import { instrument } from "../profiles/test-support.js";
import { Component as HomePage } from "./index.js";
import { groupTotal, Hero, STATUS_GROUPS } from "./sections.js";

function ownRequests(mock: ReturnType<typeof createMockApp>, index = 0) {
  const profile = mock.store.profiles[index];
  return mock.store.requests.filter((request) => request.profileId === profile?.id);
}

describe("Home hero", () => {
  it("states how many sites list the person, with one button to review them", async () => {
    const mock = createMockApp();
    const jordan = mock.store.profiles[0];
    if (!jordan) throw new Error("fixture");
    const totals = listingRollup(
      summarizeMockListings(buildMockListings(mock.store, jordan.id), mock.store.clock.now())
        .counts,
    );
    expect(totals.listed).toBeGreaterThan(0);
    renderPage(<HomePage />, { mock });
    const hero = (await screen.findByRole("heading", { name: "Where you're listed" })).closest(
      "section",
    ) as HTMLElement;
    expect(hero).toHaveTextContent(
      `Listed on ${totals.listed} ${totals.listed === 1 ? "site" : "sites"}`,
    );
    expect(hero).toHaveTextContent(
      `${totals.toConfirm} to confirm · ${totals.inProgress} in progress · ${totals.gone} gone`,
    );
    expect(within(hero).getByRole("link", { name: "Review findings" })).toHaveAttribute(
      "href",
      "/findings",
    );
    expect(hero).toHaveTextContent(/Last scan .* · next /);
  });

  it("offers another scan when a scan found nothing", async () => {
    const onScan = vi.fn();
    const { user } = renderPage(
      <Hero
        listings={{ counts: {} as never, lastScanAt: "2026-10-12T10:00:00Z", nextRescanAt: null }}
        onScan={onScan}
      />,
    );
    expect(screen.getByText("Not listed anywhere we checked")).toBeVisible();
    expect(screen.queryByRole("link", { name: "Review findings" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Scan again" }));
    expect(onScan).toHaveBeenCalled();
  });

  it("does not claim a result before the first scan", () => {
    renderPage(
      <Hero
        listings={{ counts: {} as never, lastScanAt: null, nextRescanAt: null }}
        onScan={vi.fn()}
      />,
    );
    expect(screen.getByText("Not scanned yet")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Scan again" })).toBeNull();
  });

  it("starts a scan of every site from the header without a campaign", async () => {
    const { user, mock } = renderPage(<HomePage />);
    const seen = instrument(mock);
    await user.click(await screen.findByRole("button", { name: "Scan now" }));
    const dialog = await screen.findByRole("dialog", { name: "Scan every people-search site?" });
    await user.click(within(dialog).getByRole("button", { name: "Start scans" }));
    await waitFor(() =>
      expect(
        seen.some((request) => request.method === "POST" && request.url.endsWith("/scans")),
      ).toBe(true),
    );
    expect(seen.some((request) => request.url.includes("/campaigns"))).toBe(false);
  });

  it("keeps only Scan now in the header", async () => {
    renderPage(<HomePage />);
    await screen.findByRole("heading", { name: "Home" });
    expect(screen.queryByRole("link", { name: "Send requests" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Check for replies/ })).toBeNull();
  });
});

describe("Home needs you", () => {
  it("merges the queue, mail to sort and problems into one count", async () => {
    const { mock } = renderPage(<HomePage />);
    const jordan = mock.store.profiles[0]?.id;
    const queue = buildMockNeedsYou(mock.store, jordan).counts;
    const heading = await screen.findByRole("heading", { name: /^Needs you/ });
    const section = heading.closest("section") as HTMLElement;
    const total = needsYouTotal({
      ...reviewAttention(buildMockQueue(mock.store, jordan)),
      needsYou: queue,
    } as never);
    expect(total).toBeGreaterThan(queue.active);
    expect(heading).toHaveTextContent(`Needs you · ${total}`);
    expect(
      within(section).getByText(`${total} things to do · about ${queue.minutes} min`),
    ).toBeVisible();
    expect(within(section).getByRole("link", { name: /things to do/ })).toHaveAttribute(
      "href",
      "/review",
    );
    expect(within(section).queryByRole("link", { name: "Start" })).toBeNull();
    expect(screen.queryByText(/Mail to sort|Problems/)).toBeNull();
  });

  it("shows the same number as the Inbox badge", async () => {
    renderPage(
      <>
        <SidebarContent />
        <HomePage />
      </>,
    );
    const heading = await screen.findByRole("heading", { name: /^Needs you/ });
    const total = Number(/(\d+)$/.exec(heading.textContent ?? "")?.[1]);
    expect(total).toBeGreaterThan(0);
    const inbox = screen.getByRole("link", { name: /^Inbox/ });
    await waitFor(() => expect(inbox).toHaveTextContent(`${total} items waiting`));
  });

  it("keeps Review findings the only filled button", async () => {
    renderPage(<HomePage />);
    await screen.findByRole("link", { name: /things to do/ });
    const filled = [...document.querySelectorAll("a, button")].filter((element) =>
      element.className.toString().includes("bg-accent-fill"),
    );
    expect(filled).toHaveLength(1);
    expect(filled[0]).toHaveTextContent("Review findings");
  });

  it("collapses to one muted line when nothing waits", async () => {
    const mock = createMockApp();
    mock.store.tasks = [];
    mock.store.matches = [];
    mock.store.messages = [];
    for (const request of mock.store.requests) {
      if (request.status === "needs_verification") request.status = "awaiting_reply";
    }
    renderPage(<HomePage />, { mock });
    expect(await screen.findByText("Nothing needs you")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /^Needs you/ })).toBeNull();
  });
});

describe("Home removals", () => {
  it("shows three rows that total the person's requests, and one bar", async () => {
    const mock = createMockApp();
    const own = ownRequests(mock);
    renderPage(<HomePage />, { mock });
    const heading = await screen.findByRole("heading", { name: /^Removals/ });
    expect(heading).toHaveTextContent(`Removals · ${own.length}`);
    expect(within(heading).getByRole("link")).toHaveAttribute("href", "/requests");
    const section = heading.closest("section") as HTMLElement;
    for (const group of STATUS_GROUPS) {
      const expected = own.filter((request) => group.statuses.includes(request.status)).length;
      const row = within(section).getByRole("link", { name: new RegExp(`^${group.title}`) });
      expect(row).toHaveTextContent(String(expected));
      expect(row.getAttribute("href")).toMatch(/^\/requests/);
    }
    expect(within(section).getAllByRole("link")).toHaveLength(STATUS_GROUPS.length + 1);
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("has no per-status breakdown", async () => {
    renderPage(<HomePage />);
    await screen.findByRole("heading", { name: /^Removals/ });
    expect(screen.queryByRole("link", { name: /^Confirmed/ })).toBeNull();
    expect(screen.queryByText("Awaiting reply")).toBeNull();
  });
});

describe("Home setup checklist", () => {
  it("shows the steps still missing for a person who just made a profile", async () => {
    const mock = createMockApp();
    const newcomer = mock.store.profiles[2];
    if (!newcomer) throw new Error("fixture");
    localStorage.setItem("kickrocks.profileId", newcomer.id);
    renderPage(<HomePage />, { mock });
    const heading = await screen.findByRole("heading", { name: /^Get set up/ });
    expect(heading).toHaveTextContent("Get set up · 2 of 4");
    const section = heading.closest("section") as HTMLElement;
    expect(within(section).getByRole("link", { name: /Mailbox/ })).toHaveAttribute(
      "href",
      `/profiles/${newcomer.id}/mailbox`,
    );
    expect(
      within(section).getByText("Needed to email removals. Scans work without it."),
    ).toBeVisible();
    expect(within(section).getByRole("button", { name: /First scan/ })).toBeVisible();
    expect(within(section).getByText(/Password/)).toHaveTextContent("(done)");
  });

  it("disappears once every step is done", async () => {
    renderPage(<HomePage />);
    await screen.findByRole("heading", { name: "Where you're listed" });
    expect(screen.queryByRole("heading", { name: /^Get set up/ })).toBeNull();
  });
});

describe("Home states", () => {
  it("shows a skeleton while it loads", async () => {
    renderPage(<HomePage />, { mockOptions: { latencyMs: 60 } });
    await screen.findByRole("heading", { name: "Home" });
    expect(document.querySelector("[aria-busy=true]")).not.toBeNull();
    expect(await screen.findByRole("heading", { name: /^Removals/ })).toBeInTheDocument();
    expect(document.querySelector("[aria-busy=true]")).toBeNull();
  });

  it("offers a retry when it cannot load", async () => {
    const mock = createMockApp();
    instrument(mock, {
      match: "GET /api/profiles/prf_0001/dashboard",
      status: 403,
      body: { error: "forbidden", message: "That request was blocked." },
    });
    renderPage(<HomePage />, { mock });
    expect(await screen.findByText("Could not load Home")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("asks for a profile when there are none", async () => {
    const mock = createMockApp();
    mock.store.profiles.length = 0;
    renderPage(<HomePage />, { mock });
    expect(await screen.findByText("Create a profile first")).toBeInTheDocument();
  });

  it("says why scans cannot start", async () => {
    const mock = createMockApp();
    const newcomer = mock.store.profiles[2];
    if (!newcomer) throw new Error("fixture");
    newcomer.identities = newcomer.identities.filter((identity) => identity.kind !== "address");
    localStorage.setItem("kickrocks.profileId", newcomer.id);
    renderPage(<HomePage />, { mock });
    expect(await screen.findByText(/sites can't be scanned yet/)).toBeVisible();
  });
});

describe("helpers", () => {
  it("covers every request status in exactly one group", () => {
    const all = STATUS_GROUPS.flatMap((group) => group.statuses);
    expect(new Set(all).size).toBe(all.length);
    expect(all).toHaveLength(12);
  });

  it("adds a group's counts, treating a missing status as zero", () => {
    expect(groupTotal({ queued: 2, sent: 3 }, ["queued", "sent", "draft"])).toBe(5);
  });
});
