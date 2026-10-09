import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createMockApp, type MockApp } from "../../../mock/app.js";
import { renderPage } from "../../test/render.js";
import { skewClock } from "../../test/skew-clock.js";
import { Component as DashboardPage } from "../dashboard/index.js";
import { Component as RequestDetailPage } from "../requests/detail/index.js";
import { Component as ReviewPage } from "../review/index.js";

/** Jordan's first request that still waits on an answer, which the mock's first check matches. */
function waitingRequest(mock: MockApp) {
  const jordan = mock.store.profiles[0];
  const request = mock.store.requests.find(
    (candidate) => candidate.profileId === jordan?.id && candidate.status === "awaiting_reply",
  );
  if (!jordan || !request) throw new Error("fixture request missing");
  return { jordan, request };
}

function openRequest(mock = createMockApp()) {
  const { request } = waitingRequest(mock);
  const page = renderPage(<RequestDetailPage />, {
    mock,
    path: "/requests/:id",
    route: `/requests/${request.id}`,
  });
  return { ...page, request };
}

const CHECK = { name: "Check for replies" };

describe("checking for replies on the request page", () => {
  it("shows that it is checking, then the reply it matched", async () => {
    const mock = createMockApp();
    const advance = skewClock(mock);
    const { user } = openRequest(mock);

    await user.click(await screen.findByRole("button", CHECK));
    expect(
      await screen.findByRole("button", { name: "Check for replies", busy: true }),
    ).toBeDisabled();
    advance(3_000);

    expect(await screen.findByText("1 new reply", {}, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.getByRole("button", CHECK)).toBeEnabled();
    expect(screen.queryByRole("link", { name: "Open the request" })).toBeNull();
  }, 10_000);

  it("says plainly that nothing new came in", async () => {
    const mock = createMockApp();
    const advance = skewClock(mock);
    const { user } = openRequest(mock);

    await user.click(await screen.findByRole("button", CHECK));
    advance(3_000);
    await screen.findByText("1 new reply", {}, { timeout: 4000 });

    advance(40_000);
    await user.click(screen.getByRole("button", CHECK));
    advance(3_000);
    expect(await screen.findByText("No new mail", {}, { timeout: 4000 })).toBeInTheDocument();
  }, 15_000);

  it("keeps the last result and counts the wait when a check ran moments ago", async () => {
    const mock = createMockApp();
    const advance = skewClock(mock);
    const { user } = openRequest(mock);

    await user.click(await screen.findByRole("button", CHECK));
    advance(3_000);
    await screen.findByText("1 new reply", {}, { timeout: 4000 });
    await user.click(screen.getByRole("button", CHECK));

    expect(await screen.findByText(/^Try again in \d+ seconds?\.$/)).toBeVisible();
    expect(screen.getByText("1 new reply")).toBeVisible();
    expect(screen.getByRole("button", CHECK)).toBeDisabled();
  }, 10_000);

  it("shows the mailbox error with a way to fix it", async () => {
    const mock = createMockApp();
    const advance = skewClock(mock);
    const { jordan } = waitingRequest(mock);
    if (jordan.mailbox) jordan.mailbox.replyFolder = "Broken";
    const { user } = openRequest(mock);

    await user.click(await screen.findByRole("button", CHECK));
    advance(3_000);

    expect(
      await screen.findByText("Could not check the mailbox", {}, { timeout: 4000 }),
    ).toBeVisible();
    expect(screen.getByText(/IMAP login failed/)).toBeVisible();
    expect(screen.getByRole("link", { name: "Fix the mailbox" })).toHaveAttribute(
      "href",
      `/profiles/${jordan.id}/mailbox`,
    );
  }, 10_000);

  it("shows a failed mailbox once on the dashboard, not as the result and as the standing notice", async () => {
    const mock = createMockApp();
    const advance = skewClock(mock);
    const { jordan } = waitingRequest(mock);
    if (jordan.mailbox) {
      jordan.mailbox.replyFolder = "Broken";
      jordan.mailbox.lastError = "IMAP login failed. Check the app password.";
    }
    const { user } = renderPage(<DashboardPage />, { mock });
    expect(await screen.findByText("The mailbox is not working")).toBeVisible();

    await user.click(await screen.findByRole("button", CHECK));
    advance(3_000);

    expect(
      await screen.findByText("Could not check the mailbox", {}, { timeout: 4000 }),
    ).toBeVisible();
    expect(screen.queryByText("The mailbox is not working")).toBeNull();
    expect(screen.getAllByText(/IMAP login failed/)).toHaveLength(1);
  }, 10_000);

  it("names the request a reply belongs to when it is not the one on the page", async () => {
    const mock = createMockApp();
    const advance = skewClock(mock);
    const { jordan, request } = waitingRequest(mock);
    const other = mock.store.requests.find(
      (candidate) => candidate.profileId === jordan.id && candidate.id !== request.id,
    );
    if (!other) throw new Error("fixture request missing");
    const page = renderPage(<RequestDetailPage />, {
      mock,
      path: "/requests/:id",
      route: `/requests/${other.id}`,
    });

    await page.user.click(await screen.findByRole("button", CHECK));
    advance(3_000);

    expect(
      await screen.findByText(`1 new reply, for ${request.target.name}`, {}, { timeout: 4000 }),
    ).toBeVisible();
    expect(screen.getByText("It is on that request's timeline.")).toBeVisible();
  }, 10_000);

  it("has no button for a profile without a mailbox", async () => {
    const mock = createMockApp();
    const riley = mock.store.profiles[1];
    const request = mock.store.requests.find((candidate) => candidate.profileId === riley?.id);
    if (!request) throw new Error("fixture request missing");
    renderPage(<RequestDetailPage />, {
      mock,
      path: "/requests/:id",
      route: `/requests/${request.id}`,
    });
    await screen.findByRole("heading", { level: 1 });
    expect(screen.queryByRole("button", CHECK)).toBeNull();
  });
});

describe("checking for replies elsewhere", () => {
  it("is on the dashboard, and links to a request the reply belongs to", async () => {
    const mock = createMockApp();
    const advance = skewClock(mock);
    const { request } = waitingRequest(mock);
    const { user } = renderPage(<DashboardPage />, { mock });

    await user.click(await screen.findByRole("button", CHECK));
    advance(3_000);

    expect(await screen.findByText(/^1 new reply, for /, {}, { timeout: 4000 })).toBeVisible();
    expect(screen.getByRole("link", { name: "Open the request" })).toHaveAttribute(
      "href",
      `/requests/${request.id}`,
    );
  }, 10_000);

  it("is on Review", async () => {
    renderPage(<ReviewPage />);
    expect(await screen.findByRole("button", CHECK)).toBeVisible();
  });
});
