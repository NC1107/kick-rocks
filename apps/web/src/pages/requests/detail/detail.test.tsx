import { type MessageSummary, tellEvents } from "@kickrocks/shared";
import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createMockApp, type MockApp } from "../../../../mock/app.js";
import { buildRequest } from "../../../../mock/requests.js";
import {
  BreadcrumbTailProvider,
  useBreadcrumbTailValue,
} from "../../../components/layout/breadcrumb-context.js";
import { renderPage } from "../../../test/render.js";
import { Component as RequestDetailPage } from "./index.js";
import { groupEvents, newestFirst, retryableFailure } from "./Timeline.js";

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
    expect(screen.queryByText(/by Kick Rocks/)).not.toBeInTheDocument();
  });

  it("puts the broker and the request status in the tab title", async () => {
    open(byTarget("cardinal-insights"));
    await screen.findByRole("heading", { name: "Cardinal Insights", level: 1 });
    expect(document.title).toBe("Cardinal Insights, Awaiting reply - Kick Rocks");
  });

  it("joins several rights into one sentence with only the first capitalised", async () => {
    const mock = failing(/never/);
    const request = mock.store.requests.find(
      (candidate) => candidate.targetId === "cardinal-insights",
    );
    if (!request) throw new Error("fixture");
    request.rights = ["opt_out", "delete"];
    renderPage(<RequestDetailPage />, {
      path: "/requests/:id",
      route: `/requests/${request.id}`,
      mock,
    });
    expect(await screen.findByText("Opt out of sale and delete my data")).toBeVisible();
  });

  it("orders events with the newest first", () => {
    const events = [
      { id: "a", createdAt: "2026-01-01T00:00:00.000Z" },
      { id: "b", createdAt: "2026-01-03T00:00:00.000Z" },
      { id: "c", createdAt: "2026-01-02T00:00:00.000Z" },
    ] as unknown as Parameters<typeof newestFirst>[0];
    expect(newestFirst(events).map((event) => event.id)).toEqual(["b", "c", "a"]);
  });

  it("keeps events from the same moment in reverse order of recording", () => {
    const at = "2026-01-01T00:00:00.000Z";
    const events = [
      { id: "created", createdAt: at },
      { id: "queued", createdAt: at },
      { id: "task", createdAt: at },
    ] as unknown as Parameters<typeof newestFirst>[0];
    expect(newestFirst(events).map((event) => event.id)).toEqual(["task", "queued", "created"]);
  });

  it("offers only the actions the server allows", async () => {
    open(byTarget("audiencegrid"));
    await screen.findByRole("heading", { name: "AudienceGrid", level: 1 });
    expect(screen.getAllByText("Confirmed").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Send again" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "More actions" })).not.toBeInTheDocument();
  });

  it("sends a request again straight from the page", async () => {
    const { user, mock, id } = open(byTarget("cardinal-insights"));
    await user.click(await screen.findByRole("button", { name: "Send again" }));
    const dialog = within(await screen.findByRole("dialog"));
    expect(await dialog.findByText(/privacy@/)).toBeVisible();
    expect(mock.store.requests.find((request) => request.id === id)?.status).toBe("awaiting_reply");
    await user.click(dialog.getByRole("button", { name: "Send again" }));
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
    await user.click(within(dialog).getByRole("button", { name: "Keep request" }));
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

  it("names the overflow menu when no primary action stands beside it", async () => {
    const { user } = open(byTarget("clearcheck"));
    const trigger = await screen.findByRole("button", { name: "More actions" });
    expect(trigger).toHaveTextContent("More actions");
    await user.click(trigger);
    expect(await screen.findByRole("menuitem", { name: "Cancel request" })).toBeVisible();
  });

  it("keeps the overflow menu an icon beside a primary action", async () => {
    open(byTarget("cardinal-insights"));
    const trigger = await screen.findByRole("button", { name: "More actions" });
    expect(trigger).not.toHaveTextContent("More actions");
  });

  it("lists replies and tasks", async () => {
    open(byTarget("clearcheck"));
    await screen.findByRole("heading", { name: /^Replies/ });
    expect(screen.getByText("Verification required")).toBeVisible();
    expect(screen.getByRole("heading", { name: /^Tasks/ })).toBeVisible();
  });

  describe("when a reply asked for the web form", () => {
    function askedForForm(overrides: Partial<MessageSummary> = {}) {
      const mock = failing(/never/);
      const request = mock.store.requests.find(
        (candidate) => candidate.targetId === "cardinal-insights",
      );
      const reply = mock.store.messages.find((message) => message.requestId === request?.id);
      if (!request) throw new Error("fixture");
      const message = reply ?? mock.store.messages[0];
      if (!message) throw new Error("fixture");
      message.requestId = request.id;
      message.classification = "needs_form";
      message.confidence = 0.9;
      message.links = ["https://cardinal-insights.example/privacy-requests"];
      Object.assign(message, overrides);
      return {
        request,
        message,
        ...renderPage(<RequestDetailPage />, {
          path: "/requests/:id",
          route: `/requests/${request.id}`,
          mock,
        }),
      };
    }

    it("says plainly that the company wants its web form, with the link", async () => {
      askedForForm();
      expect(await screen.findByText(/wants its web form/)).toBeVisible();
      expect(
        screen.getByRole("link", { name: /cardinal-insights\.example\/privacy-requests/ }),
      ).toBeVisible();
    });

    it("asks the person to confirm an unsure reply instead of claiming the form route", async () => {
      const { message } = askedForForm({ confidence: 0.4 });
      expect(await screen.findByText(/may want its web form/)).toBeVisible();
      expect(screen.getByText(/waiting for you to confirm/)).toBeVisible();
      expect(screen.queryByRole("link", { name: /privacy-requests/ })).not.toBeInTheDocument();
      expect(message.classification).toBe("needs_form");
    });

    it("says there is no form to reach, and shows no confirmation link, after a hand correction", async () => {
      askedForForm({ links: ["https://cardinal-insights.example/privacy/confirm?token=mock"] });
      expect(await screen.findByText(/no web form we can reach/)).toBeVisible();
      expect(screen.queryByRole("link", { name: /token=mock/ })).not.toBeInTheDocument();
    });

    it("lets the person correct what the reply was", async () => {
      const { user, message } = askedForForm();
      await screen.findByText(/wants its web form/);
      await user.click(screen.getAllByRole("button", { name: "Correct this" })[0] as HTMLElement);
      await user.selectOptions(screen.getByLabelText("What this reply is"), "auto_ack");
      await user.click(screen.getByRole("button", { name: "Apply" }));
      await waitFor(() => expect(message.classification).toBe("auto_ack"));
      await waitFor(() => expect(screen.queryByText(/wants its web form/)).not.toBeInTheDocument());
    });
  });

  it("says when the request does not exist", async () => {
    open(() => "req_9999");
    expect(await screen.findByText("Request not found.")).toBeVisible();
  });

  it("offers another try when the server will not answer", async () => {
    const mock = failing(/\/api\/requests\/req_/);
    renderPage(<RequestDetailPage />, { path: "/requests/:id", route: "/requests/req_0001", mock });
    expect(await screen.findByText("Could not load this request")).toBeVisible();
  });
});

describe("the timeline", () => {
  const at = (minutes: number) => new Date(Date.UTC(2026, 0, 1, 12, minutes)).toISOString();
  const event = (id: string, type: string, minutes: number, payload: object = {}) =>
    ({ id, type, createdAt: at(minutes), actor: "system", payload }) as never;

  it("groups events within a minute under one time", () => {
    const groups = groupEvents([
      event("a", "sent", 0),
      event("b", "reply_received", 5),
      event("c", "classified", 5),
    ]);
    expect(groups.map((group) => group.events.map((e) => e.id))).toEqual([["c", "b"], ["a"]]);
  });

  it("folds a status change into the event beside it, and keeps one that stands alone", () => {
    const grouped = groupEvents([
      event("a", "sent", 0),
      event("b", "status_changed", 0),
      event("c", "status_changed", 45),
    ]);
    expect(grouped.map((group) => group.events.map((e) => e.id))).toEqual([["c"], ["a"]]);
  });

  it("offers a retry only on the newest failure that nothing has re-queued", () => {
    const failed = event("f", "task_failed", 5, { taskId: "tsk_1" });
    const task = { id: "tsk_1", status: "failed" } as never;
    expect(retryableFailure([failed], [task])?.id).toBe("f");
    expect(retryableFailure([failed, event("q", "task_enqueued", 6)], [task])).toBeUndefined();
    expect(
      retryableFailure([failed], [{ id: "tsk_1", status: "queued" } as never]),
    ).toBeUndefined();
  });
});

describe("a failed request", () => {
  function openFailed() {
    const mock = failing(/never/);
    const request = buildRequest(mock.store, {
      profileId: mock.store.profiles[0]?.id ?? "",
      targetId: "quillnote",
      channel: "form",
      rights: ["opt_out"],
      status: "sent",
      createdDaysAgo: 0,
      failed: { error: "The submit button was not on the page after three tries" },
    });
    return {
      id: request.id,
      ...renderPage(<RequestDetailPage />, {
        path: "/requests/:id",
        route: `/requests/${request.id}`,
        mock,
      }),
    };
  }

  it("shows the error once, on the failed event, with a retry beside it", async () => {
    openFailed();
    await screen.findByRole("heading", { level: 1 });
    expect(await screen.findAllByText(/three tries/)).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Retry" })).toBeVisible();
  });

  it("queues the task again when Retry is pressed", async () => {
    const { user, mock, id } = openFailed();
    await user.click(await screen.findByRole("button", { name: "Retry" }));
    await waitFor(() =>
      expect(
        mock.store.tasks.filter((task) => task.requestId === id && task.status === "queued"),
      ).toHaveLength(1),
    );
    await waitFor(() => expect(screen.queryByRole("button", { name: "Retry" })).toBeNull());
  });

  it("shows a request's last error once when the failure was an email", async () => {
    const { mock } = open(byTarget("pixelforge"));
    const error = mock.store.requests.find((r) => r.targetId === "pixelforge")?.lastError ?? "";
    expect(error).not.toBe("");
    expect(await screen.findAllByText(new RegExp(error))).toHaveLength(1);
  });
});

describe("the request page chrome", () => {
  it("counts the timeline rows it shows, not the status changes folded away", async () => {
    const mock = failing(/never/);
    const request = mock.store.requests.find(
      (candidate) => tellEvents(candidate.events).length < candidate.events.length,
    );
    if (!request) throw new Error("fixture");
    renderPage(<RequestDetailPage />, {
      path: "/requests/:id",
      route: `/requests/${request.id}`,
      mock,
    });
    const shown = tellEvents(request.events).length;
    expect(await screen.findByText(new RegExp(`Timeline · ${shown}$`))).toBeVisible();
  });

  it("names the page by its target in the header trail", async () => {
    const mock = failing(/never/);
    const request = mock.store.requests[0];
    if (!request) throw new Error("fixture");
    function Trail() {
      const tail = useBreadcrumbTailValue();
      return <p data-testid="trail">{tail?.label ?? "none"}</p>;
    }
    renderPage(
      <BreadcrumbTailProvider>
        <Trail />
        <RequestDetailPage />
      </BreadcrumbTailProvider>,
      { path: "/requests/:id", route: `/requests/${request.id}`, mock },
    );
    await waitFor(() => expect(screen.getByTestId("trail")).toHaveTextContent(request.target.name));
  });
});
