import { type MessageSummary, tellEvents } from "@kickrocks/shared";
import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { type AgentPreset, applyAgentPreset } from "../../../../mock/agents.js";
import { createMockApp, type MockApp } from "../../../../mock/app.js";
import { buildRequest } from "../../../../mock/requests.js";
import {
  BreadcrumbTailProvider,
  useBreadcrumbTailValue,
} from "../../../components/layout/breadcrumb-context.js";
import { renderPage } from "../../../test/render.js";
import { Component as RequestDetailPage } from "./index.js";
import { correctionPicks, mentionsFormOrPhone } from "./ReplyCard.js";
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
      expect.stringMatching(/^\/review\?item=details%3Areq_\d+$/),
    );
    expect(screen.getByText("A task is waiting for you")).toBeVisible();
  });

  it("keeps the overflow menu an icon even when no primary action stands beside it", async () => {
    const { user } = open(byTarget("clearcheck"));
    const trigger = await screen.findByRole("button", { name: "More actions" });
    expect(trigger).not.toHaveTextContent("More actions");
    await user.click(trigger);
    expect(await screen.findByRole("menuitem", { name: "Cancel request" })).toBeVisible();
  });

  it("keeps the overflow menu an icon beside a primary action", async () => {
    open(byTarget("cardinal-insights"));
    const trigger = await screen.findByRole("button", { name: "More actions" });
    expect(trigger).not.toHaveTextContent("More actions");
  });

  it("lists replies and tasks, with the newest reply under the header when it is not a final answer", async () => {
    open(byTarget("clearcheck"));
    await screen.findByRole("heading", { name: /^Latest reply/ });
    expect(screen.getByText("Verification required")).toBeVisible();
    expect(screen.getByRole("heading", { name: /^Tasks/ })).toBeVisible();
  });

  it("lists a final answer under Replies instead of repeating it at the top", async () => {
    open(byTarget("audiencegrid"));
    await screen.findByRole("heading", { name: /^Replies/ });
    expect(screen.queryByRole("heading", { name: /^Latest reply/ })).toBeNull();
  });

  it("puts the replies above the summary", async () => {
    open(byTarget("audiencegrid"));
    const replies = await screen.findByRole("heading", { name: /^Replies/ });
    const summary = screen.getByRole("heading", { name: "Summary" });
    expect(
      replies.compareDocumentPosition(summary) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("links the request to its profile, its mailbox and its target", async () => {
    open(byTarget("cardinal-insights"));
    await screen.findByRole("heading", { name: "Cardinal Insights", level: 1 });
    expect(await screen.findByRole("link", { name: "Jordan Example" })).toHaveAttribute(
      "href",
      expect.stringMatching(/^\/profiles\/prf_/),
    );
    expect(await screen.findByRole("link", { name: "jordan@example.com" })).toHaveAttribute(
      "href",
      expect.stringMatching(/^\/profiles\/prf_.*\/mailbox$/),
    );
    expect(screen.getByRole("link", { name: "Cardinal Insights" })).toHaveAttribute(
      "href",
      "/targets/cardinal-insights",
    );
  });

  it("shows the legal basis as its short code", async () => {
    open(byTarget("maplewood-cinemas"));
    await screen.findByRole("heading", { name: "Maplewood Cinemas", level: 1 });
    expect(screen.getByText("MODPA")).toBeVisible();
  });

  it("opens a blocked task at its Review item", async () => {
    open(byTarget("clearcheck"));
    await screen.findByRole("heading", { name: /^Tasks/ });
    const link = await screen.findByRole("link", { name: "Submit form" });
    expect(link).toHaveAttribute("href", expect.stringMatching(/^\/review\?item=blocked%3Atsk_/));
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
      expect(screen.getByText(/Confirm and the request moves to the form route/)).toBeVisible();
      expect(screen.queryByRole("link", { name: /privacy-requests/ })).not.toBeInTheDocument();
      expect(message.classification).toBe("needs_form");
    });

    it("offers a one-tap confirm above the latest reply for an acknowledgement that sends them to a form", async () => {
      const { user, message } = askedForForm({
        classification: "auto_ack",
        confidence: 0.9,
        rationale: null,
        snippet:
          "Thanks for contacting us. We cannot take privacy requests by email. Please use our web form.",
      });
      const callout = await screen.findByText(/may want its web form/);
      const latest = screen.getByText("Latest reply");
      expect(
        callout.compareDocumentPosition(latest) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      await user.click(screen.getByRole("button", { name: "Yes, use the form" }));
      await waitFor(() => expect(message.classification).toBe("needs_form"));
    });

    it("says there is no form to reach, and shows no confirmation link, after a hand correction", async () => {
      askedForForm({ links: ["https://cardinal-insights.example/privacy/confirm?token=mock"] });
      expect(await screen.findByText(/no web form we can reach/)).toBeVisible();
      expect(screen.queryByRole("link", { name: /token=mock/ })).not.toBeInTheDocument();
    });

    it("lets the person correct what the reply was", async () => {
      const { user, message } = askedForForm();
      await screen.findByText(/wants its web form/);
      await user.click(
        screen.getAllByRole("button", { name: /Change what this reply is/ })[0] as HTMLElement,
      );
      await user.click(await screen.findByRole("menuitem", { name: /Automatic reply/ }));
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

describe("correcting a reply", () => {
  it("offers the web form first when the reply talks about a form or a phone call", () => {
    const text = "Please submit your request through our web form or call 1-800-555-0142.";
    expect(mentionsFormOrPhone(text)).toBe(true);
    expect(correctionPicks("auto_ack", text)[0]).toBe("needs_form");
    expect(correctionPicks("auto_ack", text)).not.toContain("auto_ack");
  });

  it("offers only the usual answers when the reply says nothing about another route", () => {
    expect(mentionsFormOrPhone("We received your request and will reply in 45 days.")).toBe(false);
    expect(correctionPicks("unknown", "We received your request.")).not.toContain("needs_form");
  });

  it("puts the misread receipt next to the actions, with the web form first in the menu", async () => {
    const { user } = open(byTarget("maplewood-cinemas"));
    await screen.findByRole("heading", { name: /^Latest reply/ });
    expect(screen.queryByText(/wants its web form/)).toBeNull();
    await user.click(
      screen.getAllByRole("button", { name: /Change what this reply is/ })[0] as HTMLElement,
    );
    const items = await screen.findAllByRole("menuitem");
    expect(items[0]).toHaveTextContent("Needs web form");
    expect(items.at(-1)).toHaveTextContent("Other...");
  });

  it("applies the web form answer and then says the target wants its form", async () => {
    const { user, mock } = open(byTarget("maplewood-cinemas"));
    await screen.findByRole("heading", { name: /^Latest reply/ });
    await user.click(
      screen.getAllByRole("button", { name: /Change what this reply is/ })[0] as HTMLElement,
    );
    await user.click(await screen.findByRole("menuitem", { name: /Needs web form/ }));
    await waitFor(() =>
      expect(
        mock.store.messages.find((message) =>
          message.fromAddress.endsWith("maplewoodcinemas.example"),
        )?.classification,
      ).toBe("needs_form"),
    );
    expect(await screen.findByText(/wants its web form/)).toBeVisible();
  });

  it("asks before marking a reply as a final answer", async () => {
    const { user, mock } = open(byTarget("maplewood-cinemas"));
    await screen.findByRole("heading", { name: /^Latest reply/ });
    await user.click(
      screen.getAllByRole("button", { name: /Change what this reply is/ })[0] as HTMLElement,
    );
    await user.click(await screen.findByRole("menuitem", { name: /Completed/ }));
    const dialog = await screen.findByRole("dialog");
    const cafe = (message: { fromAddress: string }) =>
      message.fromAddress.endsWith("maplewoodcinemas.example");
    expect(mock.store.messages.find(cafe)?.classification).toBe("auto_ack");
    await user.click(within(dialog).getByRole("button", { name: "Classify" }));
    await waitFor(() => expect(mock.store.messages.find(cafe)?.classification).toBe("completed"));
  });
});

describe("the agent callout", () => {
  /** A request whose agent task waits, with the agents of a preset connected. */
  function waiting(preset: AgentPreset) {
    const mock = failing(/never/);
    applyAgentPreset(mock.store, preset);
    const id = byTarget("stayfield-hotels")(mock.store) ?? "missing";
    const view = renderPage(<RequestDetailPage />, {
      path: "/requests/:id",
      route: `/requests/${id}`,
      mock,
    });
    const task = mock.store.tasks.find((candidate) => candidate.requestId === id);
    if (!task) throw new Error("fixture");
    return { ...view, mock, task };
  }

  it("offers Assign, Run now, and Keep it for me while any agent may take the task", async () => {
    waiting("one");
    expect(await screen.findByText("Waiting for an agent")).toBeVisible();
    expect(await screen.findByText("Any connected agent may take it. 1 online.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Assign" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Run now" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Keep it for me" })).toBeVisible();
  });

  it("says nothing has connected, and offers only Assign and Keep it for me", async () => {
    waiting("none");
    expect(await screen.findByText(/No agent has connected yet\./)).toBeVisible();
    expect(screen.getByRole("link", { name: "Settings, Agents" })).toHaveAttribute(
      "href",
      "/settings/agents",
    );
    expect(screen.queryByRole("button", { name: "Run now" })).not.toBeInTheDocument();
  });

  it("assigns the task to an agent worker, with the gate wording on its row", async () => {
    const { user, mock, task } = waiting("several");
    await user.click(await screen.findByRole("button", { name: "Assign" }));
    const dialog = within(await screen.findByRole("dialog"));
    expect(await dialog.findByText("Agent workers")).toBeVisible();
    expect(
      dialog.getAllByText("Every request it sends waits for your approval in Review."),
    ).not.toHaveLength(0);
    expect(
      dialog.getAllByText("Drives its own browser. Kick Rocks cannot hold what it sends."),
    ).toHaveLength(2);
    await user.click(dialog.getByRole("radio", { name: /nick-pc-agent/ }));
    expect(
      dialog.getByText("If nick-pc-agent is not seen for 30 minutes, any agent may take it."),
    ).toBeVisible();
    await user.selectOptions(dialog.getByLabelText("If it is offline for 30 minutes"), "person");
    await user.click(dialog.getByRole("button", { name: "Assign" }));
    expect(await screen.findAllByText("Assigned to nick-pc-agent")).not.toHaveLength(0);
    expect(
      mock.store.tasks.find((candidate) => candidate.id === task.id)?.assignment,
    ).toMatchObject({
      to: { kind: "model", workerId: "nick-pc-agent" },
      fallback: "person",
    });
    expect(screen.getByRole("button", { name: "Change" })).toBeVisible();
  });

  it("starts keyboard focus on the chosen agent, not on the fallback below the list", async () => {
    const { user, mock, task } = waiting("several");
    const stored = mock.store.tasks.find((candidate) => candidate.id === task.id);
    if (!stored) throw new Error("fixture");
    stored.assignment = {
      to: { kind: "model", workerId: "nick-pc-agent" },
      at: mock.store.clock.now().toISOString(),
      by: "user",
      fallback: "any",
    };
    await user.click(await screen.findByRole("button", { name: "Change" }));
    const dialog = within(await screen.findByRole("dialog"));
    const radio = await dialog.findByRole("radio", { name: /nick-pc-agent/ });
    await waitFor(() => expect(radio).toHaveFocus());
  });

  it("disables an agent the server would refuse, with the reason and where to change it", async () => {
    const { user, mock } = waiting("several");
    const target = mock.store.targets.find((candidate) => candidate.id === "stayfield-hotels");
    mock.store.settings.egress = {
      proxyUrl: "http://10.0.0.100:8888",
      domains: [target?.domain ?? ""],
    };
    await user.click(await screen.findByRole("button", { name: "Assign" }));
    const dialog = within(await screen.findByRole("dialog"));
    const radio = await dialog.findByRole("radio", { name: /desk-client/ });
    expect(radio).toBeDisabled();
    expect(
      dialog.getAllByText("This site goes through a proxy, which an MCP client cannot use."),
    ).not.toHaveLength(0);
    expect(dialog.getAllByRole("link", { name: "Open the proxy setting" })[0]).toHaveAttribute(
      "href",
      "/settings",
    );
    expect(dialog.getByRole("radio", { name: /nick-pc-agent/ })).toBeEnabled();
  });

  it("keeps the task for the person, who can then finish it or hand it back", async () => {
    const { user, mock, task } = waiting("one");
    await user.click(await screen.findByRole("button", { name: "Keep it for me" }));
    expect(await screen.findByText("You're doing this one")).toBeVisible();
    expect(screen.getByText("No agent will take it.")).toBeVisible();
    expect(mock.store.tasks.find((candidate) => candidate.id === task.id)?.assignment?.to).toEqual({
      kind: "person",
    });
    expect(screen.getByRole("button", { name: "Hand back to an agent" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Mark done" }));
    const dialog = within(await screen.findByRole("dialog"));
    await user.click(dialog.getByRole("button", { name: "Mark done" }));
    await waitFor(() =>
      expect(mock.store.tasks.find((candidate) => candidate.id === task.id)?.status).toBe("done"),
    );
  });

  it("says an MCP client cannot be woken, and shows the line to ask it with", async () => {
    const { user, task } = waiting("several");
    await user.click(await screen.findByRole("button", { name: "Assign" }));
    const dialog = within(await screen.findByRole("dialog"));
    await user.click(await dialog.findByRole("radio", { name: /desk-client/ }));
    await user.click(dialog.getByRole("button", { name: "Assign" }));
    expect(await screen.findAllByText("Assigned to desk-client")).not.toHaveLength(0);
    expect(screen.getByText("MCP clients take work when they call claim_task.")).toBeVisible();
    expect(screen.getByText(`claim_task with taskId "${task.id}"`)).toBeVisible();
    expect(screen.queryByRole("button", { name: "Run now" })).not.toBeInTheDocument();
  });

  it("starts the task now for an online agent worker, and says who works on it", async () => {
    const { user } = waiting("one");
    await user.click(await screen.findByRole("button", { name: "Run now" }));
    expect(await screen.findByText("nick-pc-agent is working on it")).toBeVisible();
    expect(screen.getByRole("button", { name: "Change" })).toBeDisabled();
    expect(screen.getByText("Wait for the run to end, or stop it in Review.")).toBeVisible();
  });
});
