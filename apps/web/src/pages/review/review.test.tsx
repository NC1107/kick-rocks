import { screen, waitFor, within } from "@testing-library/react";
import type { UserEvent } from "@testing-library/user-event";
import { useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyAgentPreset } from "../../../mock/agents.js";
import { createMockApp, type MockApp } from "../../../mock/app.js";
import { makeTask } from "../../../mock/requests.js";
import { renderPage } from "../../test/render.js";
import { Component as ReviewPage } from "./index.js";

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

const open = (route = "/review", mock = failing(/never/)) => ({
  ...renderPage(<ReviewPage />, { path: "/review/*", route, mock }),
});

const card = async (name: RegExp | string) => within(await screen.findByRole("region", { name }));

/** Opens an item by its row in the list, the way a person does, then returns its pane. */
const openItem = async (user: UserEvent, row: RegExp, pane: RegExp | string) => {
  const list = within(await screen.findByRole("navigation", { name: "Review list" }));
  await user.click(await list.findByRole("button", { name: row }));
  return card(pane);
};

const realMatchMedia = window.matchMedia;

/** jsdom has no layout, so a test says whether the list and item sit side by side. */
function setWide(wide: boolean) {
  window.matchMedia = (query: string) =>
    ({
      matches: wide && query.includes("min-width"),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }) as unknown as MediaQueryList;
}

beforeEach(() => setWide(true));
afterEach(() => {
  window.matchMedia = realMatchMedia;
});

describe("the review pages", () => {
  it("classifies unclassified mail after showing the whole message", async () => {
    const { user, mock } = open("/review/mail");
    const message = await card("Your recent message");
    expect(await message.findByText(/This is the whole message/)).toBeVisible();
    const classify = message.getByRole("button", { name: "Classify" });
    expect(classify).toBeDisabled();
    await user.selectOptions(message.getByLabelText("What is this message"), "auto_ack");
    await user.click(classify);
    await waitFor(() =>
      expect(
        mock.store.messages.find((candidate) => candidate.subject === "Your recent message")
          ?.classification,
      ).toBe("auto_ack"),
    );
  });

  it("says why a message is in the queue", async () => {
    open("/review/mail");
    const message = await card("Your recent message");
    expect(await message.findByText(/^From a company you asked\./)).toBeVisible();
  });

  it("shows the saved mail it would remove, and removes it only when the person confirms", async () => {
    const { user } = open("/review/mail");
    expect(await screen.findByText("12 saved emails to remove")).toBeVisible();
    expect(screen.queryByTestId("cleanup-preview")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Review" }));
    const preview = within(await screen.findByTestId("cleanup-preview"));
    expect(screen.getByRole("heading", { name: /Saved mail to remove · 12/ })).toBeVisible();
    expect(preview.getByText("Your order has shipped")).toBeVisible();
    await user.click(preview.getByRole("button", { name: "Confirm removal of 12" }));
    await waitFor(() => expect(screen.queryByTestId("cleanup-preview")).toBeNull());
  });

  it("lets a person attach unmatched mail to a request", async () => {
    const { user, mock } = open("/review/mail");
    const message = await card("Your recent message");
    await waitFor(() => expect(message.getByLabelText(/Which request is it about/)).toBeEnabled());
    const request = mock.store.requests[0];
    await user.selectOptions(
      message.getByLabelText(/Which request is it about/),
      request?.id ?? "",
    );
    await user.selectOptions(message.getByLabelText("What is this message"), "rejected");
    expect(message.getAllByText(/The request is marked rejected/).length).toBeGreaterThan(0);
    await user.click(message.getByRole("button", { name: "Classify" }));
    const dialog = within(await screen.findByRole("dialog"));
    expect(
      mock.store.messages.find((candidate) => candidate.subject === "Your recent message")
        ?.requestId,
    ).not.toBe(request?.id);
    await user.click(dialog.getByRole("button", { name: "Classify" }));
    await waitFor(() =>
      expect(
        mock.store.messages.find((candidate) => candidate.subject === "Your recent message")
          ?.requestId,
      ).toBe(request?.id),
    );
  });

  it("picks a classification with the number keys and the keycap buttons", async () => {
    const { user } = open("/review/mail");
    const message = await card("Your recent message");
    const select = message.getByLabelText("What is this message");
    await user.keyboard("2");
    expect(select).toHaveValue("completed");
    await user.click(message.getByRole("button", { name: /Automatic reply/ }));
    expect(select).toHaveValue("auto_ack");
    expect(message.getByRole("button", { name: /Automatic reply/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("ignores shortcut keys while a field has focus", async () => {
    const { user } = open("/review/mail");
    const message = await card("Your recent message");
    const select = message.getByLabelText("What is this message");
    await user.click(select);
    await user.keyboard("2");
    expect(select).toHaveValue("");
  });

  it("does not offer Unknown as an answer for unclassified mail", async () => {
    open("/review/mail");
    const message = await card("Your recent message");
    expect(
      within(message.getByLabelText("What is this message")).queryByRole("option", {
        name: "Unknown",
      }),
    ).not.toBeInTheDocument();
  });

  describe("a suggestion on unclassified mail", () => {
    it("starts the select on the reply model's guess and says where it came from", async () => {
      const { user, mock } = open("/review/mail");
      const message = await openItem(
        user,
        /please confirm/,
        "Re: Opt-out request - please confirm",
      );
      expect(message.getByText("Suggested by the reply model, 87% sure")).toBeVisible();
      expect(message.getByLabelText("What is this message")).toHaveValue("confirmation_link");
      expect(message.getByRole("button", { name: "Classify" })).toBeEnabled();
      await user.click(message.getByRole("button", { name: "Classify" }));
      await waitFor(() =>
        expect(
          mock.store.messages.find(
            (candidate) => candidate.subject === "Re: Opt-out request - please confirm",
          )?.classification,
        ).toBe("confirmation_link"),
      );
    });

    it("lets a quick pick override it", async () => {
      const { user } = open("/review/mail");
      const message = await openItem(
        user,
        /please confirm/,
        "Re: Opt-out request - please confirm",
      );
      await user.click(message.getByRole("button", { name: /Automatic reply/ }));
      expect(message.getByLabelText("What is this message")).toHaveValue("auto_ack");
    });

    it("asks before applying a guess that settles the request", async () => {
      const { user, mock } = open("/review/mail");
      const message = await openItem(user, /Re: Opt-out request(?! -)/, "Re: Opt-out request");
      expect(message.getByLabelText("What is this message")).toHaveValue("no_record");
      await user.click(message.getByRole("button", { name: "Classify" }));
      const dialog = within(await screen.findByRole("dialog"));
      expect(dialog.getByText(/Mark this message as/)).toBeVisible();
      expect(
        mock.store.messages.find((candidate) => candidate.subject === "Re: Opt-out request")
          ?.reviewed,
      ).toBe(false);
    });

    it("leaves a spot check unanswered, so the guess cannot sway the answer", async () => {
      const { user } = open("/review/mail");
      const message = await openItem(user, /Ticket 20931/, "Ticket 20931 received");
      expect(message.getByLabelText("What is this message")).toHaveValue("");
      expect(message.queryByText(/Suggested by/)).not.toBeInTheDocument();
      expect(message.getByRole("button", { name: "Classify" })).toBeDisabled();
    });

    it("shows Choose one when nothing was guessed", async () => {
      open("/review/mail");
      const message = await card("Your recent message");
      expect(message.getByLabelText("What is this message")).toHaveValue("");
      expect(message.queryByText(/Suggested by/)).not.toBeInTheDocument();
    });
  });

  it("lists a task nobody has taken and lets a person finish it themselves", async () => {
    const mock = failing(/never/);
    const profileId = mock.store.profiles[0]?.id ?? "";
    const queued = makeTask(
      mock.store,
      {
        kind: "agent",
        status: "queued",
        profileId,
        targetId: "audiencegrid",
        targetName: "AudienceGrid",
        requestId: null,
      },
      { minutes: 5 },
    );
    const { user } = open("/review/agents", mock);
    const task = await card(/AudienceGrid, Agent/);
    await user.click(task.getByRole("button", { name: "Mark done" }));
    const dialog = within(await screen.findByRole("dialog"));
    await user.click(dialog.getByRole("button", { name: "Mark done" }));
    await waitFor(() =>
      expect(mock.store.tasks.find((candidate) => candidate.id === queued.id)?.status).toBe("done"),
    );
  });

  it("offers a retry for a task that failed for good", async () => {
    const { user, mock } = open("/review/problems");
    const task = await card(/KinSearch, Scan for records/);
    expect(task.getByText("Failed")).toBeVisible();
    expect(task.queryByText("The site had a problem")).toBeNull();
    const before = mock.store.tasks.length;
    await user.click(task.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(mock.store.tasks.length).toBe(before + 1));
  });

  it("starts a scan of the people-search sites and lists recent scans", async () => {
    const { user, mock } = open("/review/scans");
    expect(await screen.findByRole("region", { name: "Scans" })).toBeVisible();
    const before = mock.store.scans.length;
    await user.click(screen.getByRole("button", { name: "Scan all" }));
    expect(mock.store.scans.length).toBe(before);
    await user.click(await screen.findByRole("button", { name: "Start scans" }));
    await waitFor(() => expect(mock.store.scans.length).toBeGreaterThan(before));
  });

  it("lists scans as rows because the pane beside the queue is narrow", async () => {
    open("/review/scans");
    const list = await screen.findByRole("list", { name: "Recent scans" });
    expect(within(list).getAllByRole("listitem").length).toBeGreaterThan(0);
    expect(screen.queryByRole("table", { name: "Recent scans" })).not.toBeInTheDocument();
  });

  it("says when the queue cannot load", async () => {
    open(undefined, failing(/\/api\/review/));
    expect(await screen.findByText("Could not load the review queue")).toBeVisible();
    expect(screen.getByRole("button", { name: "Try again" })).toBeVisible();
  });
});

describe("tasks waiting for an agent, by who they are for", () => {
  /** Two queued agent tasks: one assigned to an agent worker, one kept for the person. */
  function assignedTasks() {
    const mock = failing(/never/);
    applyAgentPreset(mock.store, "several");
    const [pinned, mine] = mock.store.tasks.filter(
      (task) => task.kind === "agent" && task.status === "queued",
    );
    if (!(pinned && mine)) throw new Error("fixture");
    const at = mock.store.clock.now().toISOString();
    pinned.assignment = {
      to: { kind: "model", workerId: "nick-pc-agent" },
      at,
      by: "user",
      fallback: "any",
    };
    mine.assignment = { to: { kind: "person" }, at, by: "user", fallback: "any" };
    return { mock, pinned, mine };
  }

  it("says who each waiting task is assigned to in its row", async () => {
    const { mock } = assignedTasks();
    open("/review/agents", mock);
    const list = within(await screen.findByRole("navigation", { name: "Review list" }));
    expect(await list.findByText("Assigned to nick-pc-agent")).toBeVisible();
  });
});

/** Shows where the router is, so a test can say an old address was replaced by the new one. */
function Where() {
  const { pathname, search } = useLocation();
  return <output data-testid="where">{`${pathname}${search}`}</output>;
}

function openAt(route: string, mock = failing(/never/)) {
  return renderPage(
    <>
      <Where />
      <ReviewPage />
    </>,
    { path: "/review/*", route, mock },
  );
}

const where = () => screen.getByTestId("where").textContent;

describe("the tabs under the Review title", () => {
  it("names each page and counts what is waiting there", async () => {
    open();
    const tabs = within(await screen.findByRole("navigation", { name: "Review pages" }));
    await waitFor(() => expect(tabs.getByRole("link", { name: /^Mail\s*4$/ })).toBeVisible());
    expect(tabs.getByRole("link", { name: /^Needs you\s*\d+$/ })).toHaveAttribute(
      "href",
      "/review",
    );
    expect(tabs.getByRole("link", { name: /^Mail/ })).toHaveAttribute("href", "/review/mail");
    expect(tabs.getByRole("link", { name: /^Agents/ })).toHaveAttribute("href", "/review/agents");
    expect(tabs.getByRole("link", { name: /^Problems\s*1$/ })).toHaveAttribute(
      "href",
      "/review/problems",
    );
    expect(tabs.getByRole("link", { name: "Scans" })).toHaveAttribute("href", "/review/scans");
  });

  it("marks the page that is open", async () => {
    open("/review/mail");
    const tabs = within(await screen.findByRole("navigation", { name: "Review pages" }));
    expect(tabs.getByRole("link", { name: /^Mail/ })).toHaveAttribute("aria-current", "page");
    expect(tabs.getByRole("link", { name: /^Needs you/ })).not.toHaveAttribute("aria-current");
  });
});

describe("the mail page", () => {
  it("keeps the saved-mail preview and the check for replies in the list, not above it", async () => {
    open("/review/mail");
    const banner = await screen.findByText("12 saved emails to remove");
    const list = screen.getByRole("navigation", { name: "Review list" });
    expect(list).toContainElement(banner);
    expect(within(list).getByRole("button", { name: "Check for replies" })).toBeVisible();
  });

  it("does not show the preview on the pages that are not mail", async () => {
    open("/review/problems");
    await screen.findByRole("navigation", { name: "Review list" });
    expect(screen.queryByTestId("cleanup-preview")).toBeNull();
  });
});

describe("a list page on a phone", () => {
  it("shows the list first and drills into a row, with a way back", async () => {
    setWide(false);
    const { user } = open("/review/problems");
    const list = within(await screen.findByRole("navigation", { name: "Review list" }));
    expect(list.getAllByRole("button").some((row) => row.hasAttribute("aria-current"))).toBe(false);
    await user.click(list.getByRole("button", { name: /KinSearch/ }));
    expect(await card(/KinSearch, Scan for records/)).toBeTruthy();
    const pane = within(document.getElementById("review-detail") as HTMLElement);
    await user.click(pane.getByRole("link", { name: "Review" }));
    expect(list.getAllByRole("button").some((row) => row.hasAttribute("aria-current"))).toBe(false);
  });
});

describe("addresses saved before Review was split", () => {
  it.each([
    ["blocked", "/review"],
    ["yours", "/review"],
    ["matches", "/review"],
    ["verifications", "/review"],
    ["mail", "/review/mail"],
    ["failed", "/review/problems"],
    ["agents", "/review/agents"],
    ["scans", "/review/scans"],
  ])("sends ?tab=%s to %s, replacing the old address", async (tab, destination) => {
    openAt(`/review?tab=${tab}`);
    await waitFor(() => expect(where()).toMatch(new RegExp(`^${destination}(\\?item=.*)?$`)));
  });

  it("drops the old tab from an address that already names a current item", async () => {
    openAt(`/review?tab=matches&item=${encodeURIComponent("match:abc")}`);
    await waitFor(() => expect(where()).toBe(`/review?item=${encodeURIComponent("match:abc")}`));
  });

  it("sends a blocked task of the focused queue to its task key", async () => {
    const mock = failing(/never/);
    const blocked = mock.store.tasks.find((task) => task.status === "blocked");
    if (!blocked) throw new Error("fixture");
    openAt(`/review?item=${encodeURIComponent(`blocked:${blocked.id}`)}`, mock);
    await waitFor(() =>
      expect(where()).toBe(`/review?item=${encodeURIComponent(`task:${blocked.id}`)}`),
    );
    expect(await screen.findByRole("article")).toBeVisible();
  });

  function queued(mock: MockApp, mine: boolean) {
    const task = makeTask(
      mock.store,
      {
        kind: "agent",
        status: "queued",
        profileId: mock.store.profiles[0]?.id ?? "",
        targetId: "stayfield",
        targetName: "Stayfield",
        requestId: null,
      },
      { minutes: 5 },
    );
    if (mine) {
      task.assignment = {
        to: { kind: "person" },
        at: mock.store.clock.now().toISOString(),
        by: "user",
        fallback: "any",
      };
    }
    return task;
  }

  it("sends a task the person took to its task key", async () => {
    const mock = failing(/never/);
    const mine = queued(mock, true);
    openAt(`/review?item=${encodeURIComponent(`yours:${mine.id}`)}`, mock);
    await waitFor(() =>
      expect(where()).toBe(`/review?item=${encodeURIComponent(`task:${mine.id}`)}`),
    );
  });

  it("sends a task waiting for an agent to Agents", async () => {
    const mock = failing(/never/);
    const waiting = queued(mock, false);
    openAt(`/review?item=${encodeURIComponent(`agent:${waiting.id}`)}`, mock);
    await waitFor(() =>
      expect(where()).toBe(`/review/agents?item=${encodeURIComponent(`agent:${waiting.id}`)}`),
    );
  });

  it("follows a link saved before the task changed hands", async () => {
    const mock = failing(/never/);
    const task = queued(mock, true);
    openAt(`/review?item=${encodeURIComponent(`agent:${task.id}`)}`, mock);
    await waitFor(() =>
      expect(where()).toBe(`/review?item=${encodeURIComponent(`task:${task.id}`)}`),
    );
  });

  it.each([
    ["failed:tsk_1", "/review/problems?item=failed%3Atsk_1"],
    ["mail:msg_1", "/review/mail?item=mail%3Amsg_1"],
    ["scans", "/review/scans"],
  ])("sends ?item=%s to %s", async (item, destination) => {
    openAt(`/review?item=${encodeURIComponent(item)}`);
    await waitFor(() => expect(where()).toBe(destination));
  });

  it("leaves a current address alone", async () => {
    openAt("/review?item=match%3Amtc_0001");
    await screen.findByRole("article");
    expect(where()).toBe("/review?item=match%3Amtc_0001");
  });
});
