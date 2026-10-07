import { screen, waitFor, within } from "@testing-library/react";
import type { UserEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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

const open = (tab?: string, mock = failing(/never/)) => ({
  ...renderPage(<ReviewPage />, {
    path: "/review",
    route: tab ? `/review?tab=${tab}` : "/review",
    mock,
  }),
});

const card = async (name: RegExp | string) => within(await screen.findByRole("region", { name }));

/** Opens an item by its row in the list, the way a person does, then returns its pane. */
const openItem = async (user: UserEvent, row: RegExp, pane: RegExp | string) => {
  const list = within(await screen.findByRole("navigation", { name: "Review queue" }));
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

describe("the review queue on a phone", () => {
  it("shows the list first and drills into an item, with a way back", async () => {
    setWide(false);
    const { user } = open();
    const list = within(await screen.findByRole("navigation", { name: "Review queue" }));
    expect(list.getAllByRole("button").some((row) => row.hasAttribute("aria-current"))).toBe(false);
    await user.click(list.getByRole("button", { name: /ClearCheck\s*The removal/ }));
    expect(await card(/ClearCheck, Submit form/)).toBeTruthy();
    expect(list.getByRole("button", { name: /ClearCheck\s*The removal/ })).toHaveAttribute(
      "aria-current",
      "true",
    );
    await user.click(screen.getByRole("button", { name: "Review" }));
    expect(list.getAllByRole("button").some((row) => row.hasAttribute("aria-current"))).toBe(false);
  });
});

describe("the review queue", () => {
  it("lists everything waiting under a labelled group and opens the first item", async () => {
    open();
    expect(await screen.findByRole("heading", { name: "Blocked · 3" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Records · 3" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Details asked · 2" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Unsorted mail · 2" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Failed · 1" })).toBeVisible();
    const list = within(screen.getByRole("navigation", { name: "Review queue" }));
    expect(list.getByRole("button", { name: /FindRecord/ })).toHaveAttribute(
      "aria-current",
      "true",
    );
    expect(await card(/FindRecord, Submit form/)).toBeTruthy();
  });

  it("opens the group a link names", async () => {
    open("mail");
    expect(await card("Your recent message")).toBeTruthy();
    const list = within(screen.getByRole("navigation", { name: "Review queue" }));
    expect(list.getByRole("button", { name: /Your recent message/ })).toHaveAttribute(
      "aria-current",
      "true",
    );
  });

  it("opens an item from the list when it is clicked", async () => {
    const { user } = open();
    await card(/FindRecord, Submit form/);
    const list = within(screen.getByRole("navigation", { name: "Review queue" }));
    await user.click(list.getByRole("button", { name: /ClearCheck\s*The removal/ }));
    expect(await card(/ClearCheck, Submit form/)).toBeTruthy();
    expect(
      screen.queryByRole("region", { name: /FindRecord, Submit form/ }),
    ).not.toBeInTheDocument();
  });

  it("moves through the queue with j and k", async () => {
    const { user } = open();
    await card(/FindRecord, Submit form/);
    await user.keyboard("j");
    expect(await card(/ClearCheck, Submit form/)).toBeTruthy();
    await user.keyboard("k");
    expect(await card(/FindRecord, Submit form/)).toBeTruthy();
    await user.keyboard("k");
    expect(await card(/FindRecord, Submit form/)).toBeTruthy();
  });

  it("keeps focus and selection on the same row as j and the arrows move", async () => {
    const { user } = open();
    await card(/FindRecord, Submit form/);
    const list = within(screen.getByRole("navigation", { name: "Review queue" }));
    list.getByRole("button", { name: /ClearCheck\s*The removal/ }).focus();
    await user.keyboard("j");
    await user.keyboard("{ArrowDown}");
    const current = list.getAllByRole("button").filter((row) => row.getAttribute("aria-current"));
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveFocus();
    const stops = list.getAllByRole("button").filter((row) => row.tabIndex === 0);
    expect(stops).toEqual(current);
  });

  it("selects the next item once the open one is dealt with", async () => {
    const { user } = open("blocked");
    const task = await card(/FindRecord, Submit form/);
    await user.click(task.getByRole("button", { name: "Resume" }));
    expect(await card(/ClearCheck, Submit form/)).toBeTruthy();
    expect(
      screen.queryByRole("region", { name: /FindRecord, Submit form/ }),
    ).not.toBeInTheDocument();
  });

  it("shows a blocked task with its screenshot, reason, and numbered steps", async () => {
    open("blocked");
    const task = await card(/FindRecord, Submit form/);
    expect(task.getByText("CAPTCHA")).toBeVisible();
    expect(task.getByAltText("The page where the task stopped")).toHaveAttribute(
      "src",
      expect.stringMatching(/\/api\/tasks\/tsk_\d+\/screenshot$/),
    );
    const steps = task.getAllByRole("listitem");
    expect(steps.length).toBeGreaterThanOrEqual(2);
    expect(task.getByRole("link", { name: /Open the page/ })).toHaveAttribute("target", "_blank");
  });

  it("finishes a blocked task by hand and moves its request along", async () => {
    const { user, mock } = open("blocked");
    const task = await card(/FindRecord, Submit form/);
    await user.click(task.getByRole("button", { name: "Mark done" }));
    const dialog = await screen.findByRole("dialog");
    await user.selectOptions(within(dialog).getByLabelText("How did it end"), "not_found");
    await user.type(within(dialog).getByLabelText(/Note/), "Checked by hand");
    await user.click(within(dialog).getByRole("button", { name: "Mark done" }));
    await waitFor(() =>
      expect(mock.store.requests.find((request) => request.targetId === "findrecord")?.status).toBe(
        "no_record",
      ),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("region", { name: /FindRecord, Submit form/ }),
      ).not.toBeInTheDocument(),
    );
  });

  it("resumes a task", async () => {
    const { user, mock } = open("blocked");
    const task = await openItem(user, /HomeRecords\s*The site/, /HomeRecords, Submit form/);
    await user.click(task.getByRole("button", { name: "Resume" }));
    await waitFor(() =>
      expect(
        mock.store.tasks.find((candidate) => candidate.targetId === "homerecords")?.status,
      ).toBe("queued"),
    );
  });

  it("hands a task to an agent only after a confirmation that says what an agent is", async () => {
    const mock = failing(/never/);
    mock.store.settings.mcp = { ...mock.store.settings.mcp, enabled: true };
    const { user } = open("blocked", mock);
    const task = await openItem(user, /ClearCheck\s*The removal/, /ClearCheck, Submit form/);
    await waitFor(() =>
      expect(task.getByRole("button", { name: "Hand to an agent" })).toBeEnabled(),
    );
    await user.click(task.getByRole("button", { name: "Hand to an agent" }));
    const dialog = within(await screen.findByRole("dialog"));
    expect(dialog.getByText(/AI assistant you connected/)).toBeVisible();
    expect(mock.store.tasks.some((candidate) => candidate.kind === "agent")).toBe(false);
    await user.click(dialog.getByRole("button", { name: "Hand to an agent" }));
    await waitFor(() =>
      expect(
        mock.store.tasks.some(
          (candidate) => candidate.kind === "agent" && candidate.targetId === "clearcheck",
        ),
      ).toBe(true),
    );
  });

  it("will not hand a task to an agent while agent access is off", async () => {
    const { user } = open("blocked");
    const task = await openItem(user, /ClearCheck\s*The removal/, /ClearCheck, Submit form/);
    expect(await task.findByText(/Agent access is off/)).toBeVisible();
    expect(task.getByRole("button", { name: "Hand to an agent" })).toBeDisabled();
  });

  it("cancels a task only after a confirmation", async () => {
    const { user, mock } = open("blocked");
    const task = await openItem(user, /ClearCheck\s*The removal/, /ClearCheck, Submit form/);
    await user.click(task.getByRole("button", { name: "Cancel task" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Keep it" }));
    expect(mock.store.tasks.find((candidate) => candidate.targetId === "clearcheck")?.status).toBe(
      "blocked",
    );
    await user.click(task.getByRole("button", { name: "Cancel task" }));
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Cancel task" }),
    );
    await waitFor(() =>
      expect(
        mock.store.tasks.find((candidate) => candidate.targetId === "clearcheck")?.status,
      ).toBe("cancelled"),
    );
  });

  it("tells a person to confirm a record is theirs before anything is removed", async () => {
    const { user, mock } = open("matches");
    const match = await openItem(user, /^Jordan Example\s*Found/, /Jordan Example on NameLookup/);
    expect(match.getByText(/age 62/)).toBeVisible();
    await user.click(match.getByRole("button", { name: "This is me" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("checkbox", { name: "Delete my data" }));
    await user.click(within(dialog).getByRole("button", { name: "Remove this record" }));
    await waitFor(() => {
      const request = mock.store.requests.find((candidate) =>
        candidate.recordUrl?.endsWith("jordan-example-tx-88120"),
      );
      expect(request?.rights).toEqual(["opt_out"]);
    });
  });

  it("marks a record as not the person", async () => {
    const { user, mock } = open("matches");
    const match = await openItem(user, /^Jordan Example\s*Found/, /Jordan Example on NameLookup/);
    await user.click(match.getByRole("button", { name: "Not me" }));
    await waitFor(() =>
      expect(
        mock.store.matches.find((candidate) => candidate.recordUrl.endsWith("tx-88120"))?.decision,
      ).toBe("not_mine"),
    );
  });

  it("sends nothing to a broker until a detail is ticked and the values are confirmed", async () => {
    const { user, mock } = open("verifications");
    const item = await card(/ClearCheck asked for more details/);
    const send = item.getByRole("button", { name: "Send selected details" });
    expect(send).toBeDisabled();
    const box = await item.findByRole("checkbox", { name: /^Date of birth/ });
    expect(box).not.toBeChecked();
    expect(item.getByText("1990-04-12")).toBeVisible();
    await user.click(box);
    expect(send).toBeEnabled();
    await user.click(send);
    const dialog = within(await screen.findByRole("dialog"));
    expect(dialog.getByText("1990-04-12")).toBeVisible();
    expect(mock.store.requests.find((request) => request.targetId === "clearcheck")?.status).toBe(
      "needs_verification",
    );
    await user.click(dialog.getByRole("button", { name: "Send details" }));
    await waitFor(() =>
      expect(mock.store.requests.find((request) => request.targetId === "clearcheck")?.status).toBe(
        "queued",
      ),
    );
  });

  it("does not offer a detail the profile lacks and points to the profile", async () => {
    const mock = failing(/never/);
    for (const profile of mock.store.profiles) {
      profile.identities = profile.identities.filter((identity) => identity.kind !== "dob");
    }
    open("verifications", mock);
    const item = await card(/ClearCheck asked for more details/);
    expect(await item.findByRole("link", { name: /Add a date of birth to send it/ })).toBeVisible();
    expect(item.queryByRole("checkbox", { name: /^Date of birth/ })).not.toBeInTheDocument();
  });

  it("lets a person send nothing and cancel the request", async () => {
    const { user, mock } = open("verifications");
    const item = await card(/ClearCheck asked for more details/);
    await user.click(item.getByRole("button", { name: "Send nothing and cancel" }));
    const dialog = within(await screen.findByRole("dialog"));
    await user.click(dialog.getByRole("button", { name: "Cancel request" }));
    await waitFor(() =>
      expect(mock.store.requests.find((request) => request.targetId === "clearcheck")?.status).toBe(
        "cancelled",
      ),
    );
  });

  it("classifies unclassified mail after showing the whole message", async () => {
    const { user, mock } = open("mail");
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

  it("lets a person attach unmatched mail to a request", async () => {
    const { user, mock } = open("mail");
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
    const { user } = open("mail");
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
    const { user } = open("mail");
    const message = await card("Your recent message");
    const select = message.getByLabelText("What is this message");
    await user.click(select);
    await user.keyboard("2");
    expect(select).toHaveValue("");
  });

  it("does not offer Unknown as an answer for unclassified mail", async () => {
    open("mail");
    const message = await card("Your recent message");
    expect(
      within(message.getByLabelText("What is this message")).queryByRole("option", {
        name: "Unknown",
      }),
    ).not.toBeInTheDocument();
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
    const { user } = open("agents", mock);
    const task = await card(/AudienceGrid, Agent/);
    expect(task.getByText(/No agent has taken this yet/)).toBeVisible();
    await user.click(task.getByRole("button", { name: "I did it myself" }));
    const dialog = within(await screen.findByRole("dialog"));
    await user.click(dialog.getByRole("button", { name: "Mark done" }));
    await waitFor(() =>
      expect(mock.store.tasks.find((candidate) => candidate.id === queued.id)?.status).toBe("done"),
    );
  });

  it("offers a retry for a task that failed for good", async () => {
    const { user, mock } = open("failed");
    const task = await card(/KinSearch, Scan for records/);
    expect(task.getByText("Failed")).toBeVisible();
    expect(task.queryByText("The site had a problem")).toBeNull();
    const before = mock.store.tasks.length;
    await user.click(task.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(mock.store.tasks.length).toBe(before + 1));
  });

  it("starts a scan of the people-search sites and lists recent scans", async () => {
    const { user, mock } = open("scans");
    expect(await screen.findByRole("region", { name: "Scans" })).toBeVisible();
    const before = mock.store.scans.length;
    await user.click(screen.getByRole("button", { name: "Scan people-search sites" }));
    expect(mock.store.scans.length).toBe(before);
    await user.click(await screen.findByRole("button", { name: "Start scans" }));
    await waitFor(() => expect(mock.store.scans.length).toBeGreaterThan(before));
  });

  it("says so in one line when nothing is waiting, and shows the scans", async () => {
    const mock = failing(/never/);
    mock.store.tasks = [];
    mock.store.matches = [];
    mock.store.messages = [];
    mock.store.requests = mock.store.requests.filter(
      (request) => request.status !== "needs_verification",
    );
    open(undefined, mock);
    expect(await screen.findByText("Nothing needs you.")).toBeVisible();
    expect(await screen.findByRole("region", { name: "Scans" })).toBeVisible();
  });

  it("says when the queue cannot load", async () => {
    open(undefined, failing(/\/api\/review/));
    expect(await screen.findByText("Could not load the review queue")).toBeVisible();
    expect(screen.getByRole("button", { name: "Try again" })).toBeVisible();
  });
});
