import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createMockApp, type MockApp } from "../../../mock/app.js";
import { renderPage } from "../../test/render.js";
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

/** Moves the mock's clock, so a check ends without the test waiting out its real duration. */
function skewClock(mock: MockApp) {
  let offset = 0;
  mock.store.clock.now = () => new Date(Date.now() + offset);
  return (ms: number) => {
    offset += ms;
  };
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
    expect(await screen.findByRole("button", { name: "Checking" })).toBeDisabled();
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
    expect(await screen.findByText("No new replies", {}, { timeout: 4000 })).toBeInTheDocument();
  }, 15_000);

  it("tells the person to wait when a check ran moments ago", async () => {
    const mock = createMockApp();
    const advance = skewClock(mock);
    const { user } = openRequest(mock);

    await user.click(await screen.findByRole("button", CHECK));
    advance(3_000);
    await screen.findByText("1 new reply", {}, { timeout: 4000 });
    await user.click(screen.getByRole("button", CHECK));

    expect(
      await screen.findByText(/^Checked \d+ seconds? ago\. Try again in \d+ seconds?\.$/),
    ).toBeVisible();
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

    expect(await screen.findByText("1 new reply", {}, { timeout: 4000 })).toBeVisible();
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
