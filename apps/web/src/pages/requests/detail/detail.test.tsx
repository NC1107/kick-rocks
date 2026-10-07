import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createMockApp, type MockApp } from "../../../../mock/app.js";
import { renderPage } from "../../../test/render.js";
import { Component as RequestDetailPage } from "./index.js";
import { newestFirst } from "./Timeline.js";

/** Routes matching `pattern` answer 403, a client error, so the query client does not retry and wait. */
function failing(pattern: RegExp): MockApp {
  const mock = createMockApp();
  const handle = mock.handle.bind(mock);
  mock.handle = async (request) =>
    pattern.test(request.url)
      ? {
          status: 403,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ error: "forbidden", message: "Blocked for the test." }),
        }
      : handle(request);
  return mock;
}

function open(find: (store: MockApp["store"]) => string | undefined) {
  const mock = failing(/never/);
  const id = find(mock.store) ?? "missing";
  return {
    id,
    ...renderPage(<RequestDetailPage />, { path: "/requests/:id", route: `/requests/${id}`, mock }),
  };
}

const byTarget = (target: string) => (store: MockApp["store"]) =>
  store.requests.find((request) => request.targetId === target)?.id;

describe("the request page", () => {
  it("shows the summary and a timeline written in plain sentences, newest first", async () => {
    open(byTarget("cardinal-insights"));
    expect(
      await screen.findByRole("heading", { name: "Cardinal Insights", level: 1 }),
    ).toBeVisible();
    expect(screen.getByText("Awaiting reply")).toBeVisible();
    expect(screen.getByText("Sent the email.")).toBeVisible();
  });

  it("orders events with the newest first", () => {
    const events = [
      { id: "a", createdAt: "2026-01-01T00:00:00.000Z" },
      { id: "b", createdAt: "2026-01-03T00:00:00.000Z" },
      { id: "c", createdAt: "2026-01-02T00:00:00.000Z" },
    ] as unknown as Parameters<typeof newestFirst>[0];
    expect(newestFirst(events).map((event) => event.id)).toEqual(["b", "c", "a"]);
  });

  it("offers only the actions the server allows", async () => {
    open(byTarget("audiencegrid"));
    await screen.findByRole("heading", { name: "AudienceGrid", level: 1 });
    expect(screen.getByText("Confirmed")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Send again" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "More actions" })).not.toBeInTheDocument();
  });

  it("sends a request again straight from the page", async () => {
    const { user, mock, id } = open(byTarget("cardinal-insights"));
    await user.click(await screen.findByRole("button", { name: "Send again" }));
    await waitFor(() =>
      expect(mock.store.requests.find((request) => request.id === id)?.status).toBe("queued"),
    );
    expect((await screen.findAllByText("Queued to send again")).length).toBeGreaterThan(0);
  });

  it("asks before closing a request as confirmed", async () => {
    const { user, mock, id } = open(byTarget("cardinal-insights"));
    await user.click(await screen.findByRole("button", { name: "More actions" }));
    await user.click(await screen.findByRole("menuitem", { name: "Mark as confirmed" }));
    const dialog = await screen.findByRole("dialog");
    expect(mock.store.requests.find((request) => request.id === id)?.status).toBe("awaiting_reply");
    await user.click(within(dialog).getByRole("button", { name: "Mark as confirmed" }));
    await waitFor(() =>
      expect(mock.store.requests.find((request) => request.id === id)?.status).toBe("confirmed"),
    );
  });

  it("keeps the request when the cancel dialog is dismissed", async () => {
    const { user, mock, id } = open(byTarget("cardinal-insights"));
    await user.click(await screen.findByRole("button", { name: "More actions" }));
    await user.click(await screen.findByRole("menuitem", { name: "Cancel request" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(mock.store.requests.find((request) => request.id === id)?.status).toBe("awaiting_reply");
  });

  it("points a request that needs verification at the review queue", async () => {
    open(byTarget("clearcheck"));
    expect(await screen.findByText("The target asked for more details")).toBeVisible();
    expect(screen.getByRole("link", { name: "Review what to send" })).toHaveAttribute(
      "href",
      "/review?tab=verifications",
    );
    expect(screen.getByText("A task is waiting for you")).toBeVisible();
  });

  it("lists replies and tasks", async () => {
    open(byTarget("clearcheck"));
    await screen.findByRole("heading", { name: "Replies" });
    expect(screen.getByText("Verification required")).toBeVisible();
    expect(screen.getByRole("heading", { name: "Tasks" })).toBeVisible();
  });

  it("says when the request does not exist", async () => {
    open(() => "req_9999");
    expect(await screen.findByText("Request not found")).toBeVisible();
  });

  it("offers another try when the server will not answer", async () => {
    const mock = failing(/\/api\/requests\/req_/);
    renderPage(<RequestDetailPage />, { path: "/requests/:id", route: "/requests/req_0001", mock });
    expect(await screen.findByText("Could not load this request")).toBeVisible();
  });
});
