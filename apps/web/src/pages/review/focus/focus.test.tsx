import type { TaskSummary } from "@kickrocks/shared";
import { act, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyAgentPreset } from "../../../../mock/agents.js";
import { createMockApp, type MockApp } from "../../../../mock/app.js";
import { buildMockNeedsYou } from "../../../../mock/review.js";
import { copyText } from "../../../lib/clipboard.js";
import { renderPage } from "../../../test/render.js";
import { Component as ReviewPage } from "../index.js";

vi.mock("../../../lib/clipboard.js", () => ({ copyText: vi.fn(async () => true) }));

const realMatchMedia = window.matchMedia;

/** jsdom has no layout, so a test says whether the list sits beside the card. */
function setWide(wide: boolean) {
  window.matchMedia = (query: string) =>
    ({
      matches: wide && query.includes("min-width"),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }) as unknown as MediaQueryList;
}

let opened: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  setWide(true);
  opened = vi.spyOn(window, "open").mockReturnValue(null);
});

afterEach(() => {
  window.matchMedia = realMatchMedia;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

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

/** Counts what the page sent that changes something, so a test can say nothing was sent. */
function recording(mock: MockApp): string[] {
  const sent: string[] = [];
  const handle = mock.handle.bind(mock);
  mock.handle = async (request) => {
    if (request.method !== "GET")
      sent.push(`${request.method} ${new URL(request.url, "http://x").pathname}`);
    return handle(request);
  };
  return sent;
}

const blockedTask = (mock: MockApp, reason: string): TaskSummary => {
  const task = mock.store.tasks.find(
    (candidate) => candidate.status === "blocked" && candidate.blockedReason === reason,
  );
  if (!task) throw new Error(`no ${reason} task in the fixture`);
  return task;
};

const taskKey = (mock: MockApp, reason: string) => `task:${blockedTask(mock, reason).id}`;
const holdTask = (mock: MockApp) => {
  const task = mock.store.tasks.find((candidate) => candidate.status === "leased");
  if (!task) throw new Error("no held run in the fixture");
  return task;
};
const recordKey = (mock: MockApp, urlEnd: string) => {
  const match = mock.store.matches.find((candidate) => candidate.recordUrl.endsWith(urlEnd));
  if (!match) throw new Error("no such record");
  return `match:${match.id}`;
};
const detailsKey = (mock: MockApp, targetId: string) => {
  const request = mock.store.requests.find((candidate) => candidate.targetId === targetId);
  if (!request) throw new Error("no such request");
  return `details:${request.id}`;
};

function openItem(key: string | null, mock: MockApp = createMockApp()) {
  const route = key ? `/review?item=${encodeURIComponent(key)}` : "/review";
  return renderPage(<ReviewPage />, { path: "/review/*", route, mock });
}

const cardOf = (name: RegExp | string) => screen.findByRole("article", { name });

function setVisibility(state: "hidden" | "visible") {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

/** The person goes to the other tab for a while, and comes back. */
function leaveAndReturn(awayMs = 6_000) {
  const real = Date.now();
  let offset = 0;
  vi.spyOn(Date, "now").mockImplementation(() => real + offset);
  setVisibility("hidden");
  offset += awayMs;
  setVisibility("visible");
}

describe("the primary action of each kind", () => {
  it.each([
    ["a CAPTCHA", (mock: MockApp) => taskKey(mock, "captcha"), "Open the page"],
    ["a phone code", (mock: MockApp) => taskKey(mock, "phone_verification"), "Open the page"],
    ["an ID upload", (mock: MockApp) => taskKey(mock, "id_upload"), "Open the page"],
    ["an email link", (mock: MockApp) => taskKey(mock, "email_verification"), "Done"],
    ["a sign-in", (mock: MockApp) => taskKey(mock, "login_required"), "Open the page"],
    ["a bot check", (mock: MockApp) => taskKey(mock, "bot_detection"), "Open the page"],
    [
      "a form that may be sent",
      (mock: MockApp) => taskKey(mock, "unapproved_submit"),
      "Open the page",
    ],
    ["an approval", (mock: MockApp) => taskKey(mock, "approval_needed"), "Approve"],
    ["a held request", (mock: MockApp) => `task:${holdTask(mock).id}`, "Send"],
    ["a record", (mock: MockApp) => recordKey(mock, "tx-88120"), "This is me"],
    [
      "a request for details",
      (mock: MockApp) => detailsKey(mock, "clearcheck"),
      "Pick what to send",
    ],
  ])("puts %s behind one filled button", async (_name, key, label) => {
    const mock = createMockApp();
    openItem(key(mock), mock);
    const card = within(await screen.findByRole("article"));
    const primary = await card.findByRole("button", { name: label });
    const takesEnter = label !== "Approve" && label !== "Send";
    expect(primary.hasAttribute("data-primary")).toBe(takesEnter);
    expect(card.getAllByRole("button").filter((b) => b.hasAttribute("data-primary"))).toHaveLength(
      takesEnter ? 1 : 0,
    );
  });

  it("names what the task is for in one tag", async () => {
    const mock = createMockApp();
    openItem(taskKey(mock, "captcha"), mock);
    const card = within(await cardOf("FindRecord"));
    expect(card.getByText("CAPTCHA")).toBeVisible();
    expect(card.getByText("Open the page", { selector: "li" })).toBeVisible();
    expect(card.getByText("Solve the CAPTCHA")).toBeVisible();
  });
});

describe("where you are in the queue", () => {
  it("shows done plus one of everything, and grows as items are dealt with", async () => {
    const mock = createMockApp();
    const { items } = buildMockNeedsYou(mock.store, mock.store.profiles[0]?.id);
    const total = items.length;
    const place = items.findIndex((item) => item.key === taskKey(mock, "captcha")) + 1;
    const { user } = openItem(taskKey(mock, "captcha"), mock);
    const card = within(await cardOf("FindRecord"));
    expect(card.getByText(`${place} of ${total}`)).toBeVisible();
    await user.click(card.getByRole("button", { name: "Already done" }));
    await user.click(await card.findByRole("button", { name: "Yes" }));
    await waitFor(() => expect(screen.queryByRole("article", { name: "FindRecord" })).toBeNull());
    expect(await screen.findByText(`${place + 1} of ${total}`)).toBeVisible();
  });

  it("moves with j and k, and the next and previous buttons", async () => {
    const mock = createMockApp();
    const { user } = openItem(null, mock);
    const first = await screen.findByRole("article");
    const name = first.getAttribute("aria-label");
    await user.keyboard("j");
    await waitFor(() =>
      expect(screen.getByRole("article")).not.toHaveAttribute("aria-label", name),
    );
    await user.keyboard("k");
    await waitFor(() => expect(screen.getByRole("article")).toHaveAttribute("aria-label", name));
    await user.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() =>
      expect(screen.getByRole("article")).not.toHaveAttribute("aria-label", name),
    );
    await user.click(screen.getByRole("button", { name: "Previous" }));
    await waitFor(() => expect(screen.getByRole("article")).toHaveAttribute("aria-label", name));
  });

  it("starts with the held request, then the quick items, and lists what is up next", async () => {
    const mock = createMockApp();
    openItem(null, mock);
    const first = await screen.findByRole("article");
    expect(first).toHaveAttribute("data-kind", "hold");
    const next = within(screen.getByRole("navigation", { name: "Up next" }));
    expect(next.getAllByRole("button").length).toBeGreaterThan(5);
    expect(next.getAllByRole("button")[0]).toHaveAttribute("aria-current", "true");
  });

  it("presses the primary button on Enter", async () => {
    const mock = createMockApp();
    const { user } = openItem(taskKey(mock, "captcha"), mock);
    await cardOf("FindRecord");
    await user.keyboard("{Enter}");
    expect(opened).toHaveBeenCalledWith(
      expect.stringContaining("findrecord"),
      "_blank",
      "noopener,noreferrer",
    );
  });

  it("does not approve or send on Enter, where the page would send personal data blind", async () => {
    const mock = createMockApp();
    const sent = recording(mock);
    const { user } = openItem(taskKey(mock, "approval_needed"), mock);
    await cardOf("Quillnote");
    await user.keyboard("{Enter}");
    expect(sent).toEqual([]);
  });

  it("follows the open item in the count as the person browses", async () => {
    const mock = createMockApp();
    const { user } = openItem(null, mock);
    await screen.findByRole("article");
    const count = () => screen.getByText(/^\d+ of \d+$/).textContent;
    const first = count();
    await user.keyboard("j");
    await waitFor(() => expect(count()).not.toBe(first));
  });

  it("shows the list as a sheet on a phone", async () => {
    setWide(false);
    const mock = createMockApp();
    const { user } = openItem(taskKey(mock, "captcha"), mock);
    await cardOf("FindRecord");
    await user.click(screen.getByRole("button", { name: "More" }));
    await user.click(await screen.findByRole("menuitem", { name: "Show list" }));
    const sheet = within(await screen.findByRole("dialog"));
    await user.click(sheet.getAllByRole("button", { name: /ClearCheck/ })[0] as HTMLElement);
    expect(await cardOf("ClearCheck")).toBeVisible();
  });
});

describe("details to type in", () => {
  it("says so when the copy failed, and keeps the value in view to copy by hand", async () => {
    vi.mocked(copyText).mockResolvedValueOnce(false);
    const mock = createMockApp();
    const { user } = openItem(taskKey(mock, "captcha"), mock);
    const card = within(await cardOf("FindRecord"));
    const chip = await card.findByRole("button", { name: "Copy email" });
    await user.click(chip);
    expect(chip).toHaveTextContent("Copy failed");
    await waitFor(() => expect(chip).toHaveTextContent("jordan@example.com"), {
      timeout: 3_000,
    });
  });

  it("hides each value until it is tapped, then copies it and shows it", async () => {
    const mock = createMockApp();
    const { user } = openItem(taskKey(mock, "captcha"), mock);
    const card = within(await cardOf("FindRecord"));
    const chip = await card.findByRole("button", { name: "Copy email" });
    expect(chip).toHaveTextContent("j•••@example.com");
    expect(chip).not.toHaveTextContent("jordan@example.com");

    await user.click(chip);

    expect(copyText).toHaveBeenCalledWith("jordan@example.com");
    expect(chip).toHaveTextContent("Copied");
    expect(chip).toHaveAccessibleName("Copy email");
    await waitFor(() => expect(chip).toHaveTextContent("jordan@example.com"), {
      timeout: 3_000,
    });
  });

  it("offers a name and an email for a CAPTCHA, and a phone for a texted code", async () => {
    const mock = createMockApp();
    openItem(taskKey(mock, "phone_verification"), mock);
    const card = within(await cardOf("HomeRecords"));
    expect(await card.findByRole("button", { name: "Copy phone" })).toBeVisible();
    expect(card.getByRole("button", { name: "Copy name" })).toBeVisible();
    expect(card.queryByRole("button", { name: "Copy email" })).toBeNull();
  });

  it("says who the email comes from beside the email chip", async () => {
    const mock = createMockApp();
    openItem(taskKey(mock, "email_verification"), mock);
    const card = within(await cardOf("AudienceGrid"));
    expect(await card.findByText(/^from /)).toBeVisible();
    expect(card.getByRole("button", { name: "Copy email" })).toBeVisible();
  });
});

describe("did it work", () => {
  it("opens the page, tells the server, and asks when the person comes back", async () => {
    const mock = createMockApp();
    const task = blockedTask(mock, "captcha");
    const { user } = openItem(`task:${task.id}`, mock);
    const card = within(await cardOf("FindRecord"));
    await user.click(card.getByRole("button", { name: "Open the page" }));
    expect(opened).toHaveBeenCalledWith(
      "https://www.findrecord.example/p/jordan-q-example-9027",
      "_blank",
      "noopener,noreferrer",
    );
    await waitFor(() =>
      expect(mock.store.needsYouMarks.get(`task:${task.id}`)?.openedAt).toBeTruthy(),
    );
    expect(screen.queryByText("Did it work?")).toBeNull();

    leaveAndReturn();

    expect(await screen.findByText("Did it work?")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Open the page" })).toBeNull();
  });

  it("does not ask after only a moment away", async () => {
    const mock = createMockApp();
    const { user } = openItem(taskKey(mock, "captcha"), mock);
    const card = within(await cardOf("FindRecord"));
    await user.click(card.getByRole("button", { name: "Open the page" }));
    leaveAndReturn(1_000);
    expect(screen.queryByText("Did it work?")).toBeNull();
  });

  it("marks the task done as submitted on Yes, says so, and moves to the next item", async () => {
    const mock = createMockApp();
    const task = blockedTask(mock, "captcha");
    const { user } = openItem(`task:${task.id}`, mock);
    const card = within(await cardOf("FindRecord"));
    await user.click(card.getByRole("button", { name: "Open the page" }));
    leaveAndReturn();
    await user.click(await screen.findByRole("button", { name: "Yes" }));
    await waitFor(() =>
      expect(mock.store.tasks.find((t) => t.id === task.id)?.status).toBe("done"),
    );
    const completed = mock.store.requests
      .find((request) => request.id === task.requestId)
      ?.events.find((event) => event.type === "task_completed" && event.payload.taskId === task.id);
    expect(completed?.payload).toMatchObject({ outcome: "submitted" });
    expect(await screen.findByText("Done · FindRecord")).toBeVisible();
    expect(screen.queryByRole("article", { name: "FindRecord" })).toBeNull();
    expect(mock.store.needsYouMarks.get(`task:${task.id}`)?.openedAt ?? null).toBeNull();
  });

  it.each([
    ["No record", "no_record"],
    ["Already gone", "no_record"],
    ["Needs email link", "awaiting_reply"],
  ])("reports %s as another way it ended", async (label, status) => {
    const mock = createMockApp();
    const task = blockedTask(mock, "captcha");
    const { user } = openItem(`task:${task.id}`, mock);
    const card = within(await cardOf("FindRecord"));
    await user.click(card.getByRole("button", { name: "Already done" }));
    await user.click(await card.findByRole("button", { name: label }));
    await waitFor(() =>
      expect(mock.store.tasks.find((t) => t.id === task.id)?.status).toBe("done"),
    );
    expect(mock.store.requests.find((request) => request.id === task.requestId)?.status).toBe(
      status,
    );
  });

  it("counts Not yet, writes it on the timeline, and moves on", async () => {
    const mock = createMockApp();
    const task = blockedTask(mock, "captcha");
    const { user } = openItem(`task:${task.id}`, mock);
    const card = within(await cardOf("FindRecord"));
    await user.click(card.getByRole("button", { name: "Already done" }));
    await user.click(await card.findByRole("button", { name: "Not yet" }));
    await waitFor(() => expect(mock.store.needsYouMarks.get(`task:${task.id}`)?.tries).toBe(1));
    const request = mock.store.requests.find((candidate) => candidate.id === task.requestId);
    expect(request?.events.find((event) => event.type === "user_action")?.payload).toMatchObject({
      action: "not_yet",
    });
    await waitFor(() => expect(screen.queryByRole("article", { name: "FindRecord" })).toBeNull());
    expect(mock.store.tasks.find((t) => t.id === task.id)?.status).toBe("blocked");
  });

  it("shows the tries on the card when the item comes round again", async () => {
    const mock = createMockApp();
    const task = blockedTask(mock, "captcha");
    mock.store.needsYouMarks.set(`task:${task.id}`, {
      updatedAt: new Date().toISOString(),
      snoozedUntil: null,
      openedAt: null,
      tries: 1,
      lastTriedAt: new Date().toISOString(),
    });
    openItem(`task:${task.id}`, mock);
    const card = within(await cardOf("FindRecord"));
    expect(card.getByText("Tried 1×")).toBeVisible();
    expect(card.queryByText("Stuck? Hand to an agent")).toBeNull();
  });

  function tried(mock: MockApp, task: TaskSummary, tries: number) {
    mock.store.needsYouMarks.set(`task:${task.id}`, {
      updatedAt: new Date().toISOString(),
      snoozedUntil: null,
      openedAt: null,
      tries,
      lastTriedAt: new Date().toISOString(),
    });
  }

  it("offers to hand it to an agent after two tries, once, when an agent is connected", async () => {
    const mock = createMockApp();
    applyAgentPreset(mock.store, "one");
    const task = blockedTask(mock, "login_required");
    tried(mock, task, 2);
    const { user } = openItem(`task:${task.id}`, mock);
    const card = within(await cardOf("Lumen Data Partners"));
    expect(await card.findByRole("button", { name: "Stuck? Hand to an agent" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "More" }));
    expect(await screen.findByRole("menuitem", { name: "Snooze" })).toBeVisible();
    expect(screen.queryByRole("menuitem", { name: /Hand to an agent/ })).toBeNull();
  });

  it("never offers a hand-off for a bot check, a CAPTCHA, a phone code or an ID upload", async () => {
    for (const reason of ["bot_detection", "captcha", "phone_verification", "id_upload"]) {
      const mock = createMockApp();
      applyAgentPreset(mock.store, "several");
      const task = blockedTask(mock, reason);
      tried(mock, task, 3);
      const { user, unmount } = openItem(`task:${task.id}`, mock);
      await cardOf(task.targetName ?? "");
      await user.click(screen.getByRole("button", { name: "More" }));
      await screen.findByRole("menuitem", { name: "Snooze" });
      expect(screen.queryByRole("menuitem", { name: /agent/i })).toBeNull();
      expect(screen.queryByRole("button", { name: /Hand to an agent/ })).toBeNull();
      unmount();
    }
  });

  it("does not offer a hand-off on a form that may be sent, where it would lead nowhere", async () => {
    const mock = createMockApp();
    mock.store.settings.mcp = { ...mock.store.settings.mcp, enabled: true };
    const task = blockedTask(mock, "unapproved_submit");
    mock.store.needsYouMarks.set(`task:${task.id}`, {
      updatedAt: new Date().toISOString(),
      snoozedUntil: null,
      openedAt: null,
      tries: 2,
      lastTriedAt: new Date().toISOString(),
    });
    openItem(`task:${task.id}`, mock);
    const card = within(await cardOf("Harbor Consumer Data"));
    expect(await card.findByText("Tried 2×")).toBeVisible();
    expect(card.queryByRole("button", { name: "Stuck? Hand to an agent" })).toBeNull();
  });

  it("goes to the next item on Skip without telling the server anything", async () => {
    const mock = createMockApp();
    const sent = recording(mock);
    const { user } = openItem(taskKey(mock, "captcha"), mock);
    const card = within(await cardOf("FindRecord"));
    await user.click(card.getByRole("button", { name: "Already done" }));
    await user.click(await card.findByRole("button", { name: "Skip" }));
    await waitFor(() => expect(screen.queryByRole("article", { name: "FindRecord" })).toBeNull());
    expect(sent).toEqual([]);
  });

  it("asks again after a reload, from the time the page was opened", async () => {
    const mock = createMockApp();
    const task = blockedTask(mock, "captcha");
    mock.store.needsYouMarks.set(`task:${task.id}`, {
      updatedAt: new Date().toISOString(),
      snoozedUntil: null,
      openedAt: new Date(Date.now() - 10 * 60_000).toISOString(),
      tries: 0,
      lastTriedAt: null,
    });
    openItem(`task:${task.id}`, mock);
    expect(await screen.findByText("Did it work?")).toBeVisible();
  });

  it("does not ask about a page opened long ago", async () => {
    const mock = createMockApp();
    const task = blockedTask(mock, "captcha");
    mock.store.needsYouMarks.set(`task:${task.id}`, {
      updatedAt: new Date().toISOString(),
      snoozedUntil: null,
      openedAt: new Date(Date.now() - 3 * 3_600_000).toISOString(),
      tries: 0,
      lastTriedAt: null,
    });
    openItem(`task:${task.id}`, mock);
    await cardOf("FindRecord");
    expect(screen.queryByText("Did it work?")).toBeNull();
  });

  it("answers Skip with s", async () => {
    const mock = createMockApp();
    const sent = recording(mock);
    const { user } = openItem(taskKey(mock, "captcha"), mock);
    const card = within(await cardOf("FindRecord"));
    await user.click(card.getByRole("button", { name: "Already done" }));
    await user.keyboard("s");
    await waitFor(() => expect(screen.queryByRole("article", { name: "FindRecord" })).toBeNull());
    expect(sent).toEqual([]);
  });

  it("answers Not yet with n", async () => {
    const mock = createMockApp();
    const task = blockedTask(mock, "captcha");
    const { user } = openItem(`task:${task.id}`, mock);
    const card = within(await cardOf("FindRecord"));
    await user.click(card.getByRole("button", { name: "Already done" }));
    await user.keyboard("n");
    await waitFor(() => expect(mock.store.needsYouMarks.get(`task:${task.id}`)?.tries).toBe(1));
  });

  it("answers Yes with y", async () => {
    const mock = createMockApp();
    const task = blockedTask(mock, "captcha");
    const { user } = openItem(`task:${task.id}`, mock);
    const card = within(await cardOf("FindRecord"));
    await user.click(card.getByRole("button", { name: "Already done" }));
    await user.keyboard("y");
    await waitFor(() =>
      expect(mock.store.tasks.find((t) => t.id === task.id)?.status).toBe("done"),
    );
  });
});

describe("snoozing", () => {
  it("hides the item until the time the person picked, in their own time zone", async () => {
    const mock = createMockApp();
    const task = blockedTask(mock, "captcha");
    const { user } = openItem(`task:${task.id}`, mock);
    await cardOf("FindRecord");
    await user.keyboard("z");
    const sheet = within(await screen.findByRole("dialog"));
    await user.click(sheet.getByRole("button", { name: /Tomorrow/ }));

    const mark = await waitFor(() => {
      const found = mock.store.needsYouMarks.get(`task:${task.id}`);
      if (!found?.snoozedUntil) throw new Error("not yet");
      return found;
    });
    const until = new Date(mark.snoozedUntil as string);
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    expect([
      until.getFullYear(),
      until.getMonth(),
      until.getDate(),
      until.getHours(),
      until.getMinutes(),
    ]).toEqual([tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate(), 9, 0]);
    expect(await screen.findByText("Snoozed till 9 AM")).toBeVisible();
    await waitFor(() => expect(screen.queryByRole("article", { name: "FindRecord" })).toBeNull());
    expect(await screen.findByText(/^\d+ snoozed$/)).toBeVisible();
  });

  it("brings a snoozed item back from the list", async () => {
    const mock = createMockApp();
    const task = blockedTask(mock, "captcha");
    mock.store.needsYouMarks.set(`task:${task.id}`, {
      updatedAt: new Date().toISOString(),
      snoozedUntil: new Date(Date.now() + 3_600_000).toISOString(),
      openedAt: null,
      tries: 0,
      lastTriedAt: null,
    });
    const { user } = openItem(null, mock);
    await screen.findByRole("article");
    await user.click(await screen.findByRole("button", { name: "1 snoozed" }));
    await user.click(screen.getByRole("button", { name: "Bring back" }));
    await waitFor(() =>
      expect(mock.store.needsYouMarks.get(`task:${task.id}`)?.snoozedUntil).toBeNull(),
    );
  });

  it("cannot be done to a held request", async () => {
    const mock = createMockApp();
    const { user } = openItem(`task:${holdTask(mock).id}`, mock);
    await cardOf(/Cardinal/);
    await user.click(screen.getByRole("button", { name: "More" }));
    expect(screen.queryByRole("menuitem", { name: "Snooze" })).toBeNull();
    await user.keyboard("{Escape}");
    await user.keyboard("z");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("lists what is snoozed when the address asks for it", async () => {
    const mock = createMockApp();
    const task = blockedTask(mock, "captcha");
    mock.store.needsYouMarks.set(`task:${task.id}`, {
      updatedAt: new Date().toISOString(),
      snoozedUntil: new Date(Date.now() + 3_600_000).toISOString(),
      openedAt: null,
      tries: 0,
      lastTriedAt: null,
    });
    renderPage(<ReviewPage />, { path: "/review/*", route: "/review?show=snoozed", mock });
    expect(await screen.findByText("FindRecord")).toBeVisible();
    expect(screen.getByRole("button", { name: "Bring back" })).toBeVisible();
  });
});

describe("a record", () => {
  const pending = (mock: MockApp, urlEnd: string) =>
    mock.store.matches.find((match) => match.recordUrl.endsWith(urlEnd));

  it("asks for the removal only after five seconds, and can be taken back", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const mock = createMockApp();
    const { user } = openItem(recordKey(mock, "tx-88120"), mock);
    const card = within(await cardOf("Jordan Example"));
    await user.click(card.getByRole("button", { name: "This is me" }));
    await screen.findAllByText("Removal queued");
    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(pending(mock, "tx-88120")?.decision).toBe("pending");
    await user.click(screen.getByRole("button", { name: "Undo" }));
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(pending(mock, "tx-88120")?.decision).toBe("pending");
    expect(await cardOf("Jordan Example")).toBeVisible();
  });

  it("sends it on the timeout, asking for an opt-out and a deletion", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const mock = createMockApp();
    const { user } = openItem(recordKey(mock, "tx-88120"), mock);
    const card = within(await cardOf("Jordan Example"));
    await user.click(card.getByRole("button", { name: "This is me" }));
    await screen.findAllByText("Removal queued");
    act(() => {
      vi.advanceTimersByTime(5_100);
    });
    await waitFor(() => expect(pending(mock, "tx-88120")?.decision).toBe("mine"));
    const request = mock.store.requests.find((candidate) =>
      candidate.recordUrl?.endsWith("tx-88120"),
    );
    expect(request?.rights).toEqual(["opt_out", "delete"]);
  });

  it("sends it at once when the person leaves the page", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const mock = createMockApp();
    const { user, unmount } = openItem(recordKey(mock, "tx-88120"), mock);
    const card = within(await cardOf("Jordan Example"));
    await user.click(card.getByRole("button", { name: "This is me" }));
    await screen.findAllByText("Removal queued");
    expect(pending(mock, "tx-88120")?.decision).toBe("pending");
    unmount();
    await waitFor(() => expect(pending(mock, "tx-88120")?.decision).toBe("mine"));
  });

  it("sends with keepalive when the page is hidden or closed, so the request outlives it", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const mock = createMockApp();
    const keepalive: boolean[] = [];
    const { user } = openItem(recordKey(mock, "tx-88120"), mock);
    const card = within(await cardOf("Jordan Example"));
    const realFetch = globalThis.fetch;
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes("/decision")) keepalive.push(init?.keepalive === true);
      return realFetch(input, init);
    });
    await user.click(card.getByRole("button", { name: "This is me" }));
    await screen.findAllByText("Removal queued");
    setVisibility("hidden");
    await waitFor(() => expect(pending(mock, "tx-88120")?.decision).toBe("mine"));
    expect(keepalive).toEqual([true]);
    setVisibility("visible");
  });

  it("asks for an opt-out alone from the menu", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const mock = createMockApp();
    const { user } = openItem(recordKey(mock, "tx-88120"), mock);
    await cardOf("Jordan Example");
    await user.click(screen.getByRole("button", { name: "More" }));
    await user.click(await screen.findByRole("menuitem", { name: "Opt-out only" }));
    act(() => {
      vi.advanceTimersByTime(5_100);
    });
    await waitFor(() => expect(pending(mock, "tx-88120")?.decision).toBe("mine"));
    const request = mock.store.requests.find((candidate) =>
      candidate.recordUrl?.endsWith("tx-88120"),
    );
    expect(request?.rights).toEqual(["opt_out"]);
  });

  it("marks it as not the person, also with an undo", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const mock = createMockApp();
    const { user } = openItem(recordKey(mock, "tx-88120"), mock);
    const card = within(await cardOf("Jordan Example"));
    await user.click(card.getByRole("button", { name: "Not me" }));
    await screen.findAllByText("Marked not you");
    act(() => {
      vi.advanceTimersByTime(5_100);
    });
    await waitFor(() => expect(pending(mock, "tx-88120")?.decision).toBe("not_mine"));
  });

  it("says so when the decision could not be saved, and brings the record back", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const mock = failing(/\/api\/matches\/.*\/decision/);
    const { user } = openItem(recordKey(mock, "tx-88120"), mock);
    const card = within(await cardOf("Jordan Example"));
    await user.click(card.getByRole("button", { name: "Not me" }));
    act(() => {
      vi.advanceTimersByTime(5_100);
    });
    expect(await screen.findByText("Could not save that")).toBeVisible();
    const next = within(screen.getByRole("navigation", { name: "Up next" }));
    expect(next.getAllByRole("button", { name: /Jordan Example/ }).length).toBeGreaterThan(0);
  });
});

describe("a request for details", () => {
  it("sends nothing until a detail is ticked, and counts what is ticked", async () => {
    const mock = createMockApp();
    const { user } = openItem(detailsKey(mock, "clearcheck"), mock);
    const card = within(await cardOf("ClearCheck"));
    const send = await card.findByRole("button", { name: "Pick what to send" });
    expect(send).toBeDisabled();
    const dob = await card.findByRole("button", { name: /^Date of birth/ });
    expect(dob).toHaveAttribute("aria-pressed", "false");
    expect(dob).toHaveTextContent("1990-••-••");
    await user.click(dob);
    expect(dob).toHaveAttribute("aria-pressed", "true");
    await user.click(card.getByRole("button", { name: "Send 1 detail" }));
    await waitFor(() =>
      expect(mock.store.requests.find((request) => request.targetId === "clearcheck")?.status).toBe(
        "queued",
      ),
    );
  });

  it("says that only ticked details go out", async () => {
    const mock = createMockApp();
    openItem(detailsKey(mock, "clearcheck"), mock);
    const card = within(await cardOf("ClearCheck"));
    expect(card.getByText("Only ticked details go out.")).toBeVisible();
  });

  it("does not offer a detail the profile lacks and points to the profile", async () => {
    const mock = createMockApp();
    for (const profile of mock.store.profiles) {
      profile.identities = profile.identities.filter((identity) => identity.kind !== "dob");
    }
    openItem(detailsKey(mock, "clearcheck"), mock);
    const card = within(await cardOf("ClearCheck"));
    expect(await card.findByRole("link", { name: "Add it" })).toBeVisible();
    expect(card.queryByRole("button", { name: /^Date of birth/ })).toBeNull();
  });

  it("lets the person send nothing and cancel the request, after a question", async () => {
    const mock = createMockApp();
    const { user } = openItem(detailsKey(mock, "clearcheck"), mock);
    const card = within(await cardOf("ClearCheck"));
    await user.click(await card.findByRole("button", { name: "Don't send" }));
    const dialog = within(await screen.findByRole("dialog"));
    await user.click(dialog.getByRole("button", { name: "Keep it" }));
    expect(mock.store.requests.find((request) => request.targetId === "clearcheck")?.status).toBe(
      "needs_verification",
    );
    await user.click(card.getByRole("button", { name: "Don't send" }));
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Cancel request" }),
    );
    await waitFor(() =>
      expect(mock.store.requests.find((request) => request.targetId === "clearcheck")?.status).toBe(
        "cancelled",
      ),
    );
  });
});

describe("a request held for the person", () => {
  it("shows where it is going and a few of its fields, with the rest behind a disclosure", async () => {
    const mock = createMockApp();
    openItem(`task:${holdTask(mock).id}`, mock);
    const card = within(await cardOf("Cardinal Insights"));
    expect((await card.findAllByText(/^POST cardinal\.example/))[0]).toBeVisible();
    expect(card.getByText(/^Waiting · [89]:\d\d$/)).toBeVisible();
    expect(card.getByText("About to send.")).toBeVisible();
    expect(card.getByRole("button", { name: /Show all fields/ })).toBeVisible();
  });

  it("sends the request when the person says send", async () => {
    const mock = createMockApp();
    const { user } = openItem(`task:${holdTask(mock).id}`, mock);
    const card = within(await cardOf("Cardinal Insights"));
    await user.click(await card.findByRole("button", { name: "Send" }));
    await waitFor(() => {
      const rows = [...mock.store.sends.values()].flatMap((sends) => sends.rows);
      expect(rows.some((row) => row.kind === "released" && row.responseStatus === 200)).toBe(true);
    });
  });

  it("holds it back on Don't send", async () => {
    const mock = createMockApp();
    const { user } = openItem(`task:${holdTask(mock).id}`, mock);
    const card = within(await cardOf("Cardinal Insights"));
    await user.click(await card.findByRole("button", { name: "Don't send" }));
    await waitFor(() => {
      const rows = [...mock.store.sends.values()].flatMap((sends) => sends.rows);
      expect(rows.some((row) => row.status === "declined")).toBe(true);
    });
  });

  it("finishes by hand from the menu: holds it back and opens the page", async () => {
    const mock = createMockApp();
    const task = holdTask(mock);
    mock.store.blockedInfo.set(task.id, {
      url: "https://cardinal.example/optout",
      manualInstructions: "",
    });
    const { user } = openItem(`task:${task.id}`, mock);
    await cardOf("Cardinal Insights");
    await user.click(screen.getByRole("button", { name: "More" }));
    await user.click(await screen.findByRole("menuitem", { name: "Finish by hand" }));
    await waitFor(() => expect(opened).toHaveBeenCalled());
    await waitFor(() => {
      const rows = [...mock.store.sends.values()].flatMap((sends) => sends.rows);
      expect(rows.some((row) => row.status === "declined")).toBe(true);
    });
  });

  it("says so when the hold ran out before the person decided", async () => {
    const mock = createMockApp();
    const { user } = openItem(`task:${holdTask(mock).id}`, mock);
    const card = within(await cardOf("Cardinal Insights"));
    const send = await card.findByRole("button", { name: "Send" });
    for (const sends of mock.store.sends.values()) {
      for (const row of sends.rows) {
        if (row.status === "pending_live")
          row.expiresAt = new Date(Date.now() - 1000).toISOString();
      }
    }
    await user.click(send);
    expect(await card.findByText(/no longer waiting/)).toBeVisible();
  });
});

describe("a run that stopped before sending", () => {
  it("approves what it held, and says it runs again soon", async () => {
    const mock = createMockApp();
    const { user } = openItem(taskKey(mock, "approval_needed"), mock);
    const card = within(await cardOf("Quillnote"));
    await user.click(await card.findByRole("button", { name: "Approve" }));
    await waitFor(() =>
      expect(
        mock.store.tasks.find(
          (candidate) => candidate.kind === "agent" && candidate.targetId === "quillnote",
        )?.status,
      ).toBe("queued"),
    );
    expect(await screen.findByText("Approved · runs again soon")).toBeVisible();
  });

  it("shows the held requests open, with the step that went out before", async () => {
    const mock = createMockApp();
    const { user } = openItem(taskKey(mock, "approval_needed"), mock);
    const card = within(await cardOf("Quillnote"));
    expect(
      await card.findByText(
        /Step 1 already went out once\. Approving sends it again, then step 2\./,
      ),
    ).toBeVisible();
    await user.click(card.getByText("What the gate cannot see"));
    expect(card.getByText(/Sites that need a live connection\./)).toBeVisible();
  });

  it("lets the person leave a request out of the approval", async () => {
    const mock = createMockApp();
    const { user } = openItem(taskKey(mock, "approval_needed"), mock);
    const card = within(await cardOf("Quillnote"));
    await user.click(await card.findByRole("checkbox", { name: /Leave this one out/ }));
    await user.click(card.getByRole("button", { name: "Approve" }));
    await waitFor(() => {
      const rows = [...mock.store.sends.values()].flatMap((sends) => sends.rows);
      expect(rows.some((row) => row.status === "declined")).toBe(true);
    });
  });

  it("offers to run again when an old stop has nothing held", async () => {
    const mock = createMockApp();
    const task = blockedTask(mock, "approval_needed");
    mock.store.sends.delete(task.id);
    const { user } = openItem(`task:${task.id}`, mock);
    const card = within(await cardOf("Quillnote"));
    await user.click(await card.findByRole("button", { name: "Run again" }));
    expect(card.queryByRole("button", { name: "Approve" })).toBeNull();
    await waitFor(() =>
      expect(mock.store.tasks.find((t) => t.id === task.id)?.status).toBe("queued"),
    );
  });

  it("lets the person do it themselves, which leads to the question", async () => {
    const mock = createMockApp();
    const { user } = openItem(taskKey(mock, "approval_needed"), mock);
    const card = within(await cardOf("Quillnote"));
    await user.click(await card.findByRole("button", { name: "Do it myself" }));
    expect(opened).toHaveBeenCalled();
    leaveAndReturn();
    expect(await screen.findByText("Did it work?")).toBeVisible();
  });

  it("shows what left the browser when the form may already be sent", async () => {
    const mock = createMockApp();
    const { user } = openItem(taskKey(mock, "unapproved_submit"), mock);
    const card = within(await cardOf("Harbor Consumer Data"));
    expect(card.getByText("Check sent")).toBeVisible();
    await user.click(await card.findByRole("button", { name: "What was sent" }));
    expect(card.queryByText(/left the browser/)).toBeNull();
    expect((await card.findAllByRole("listitem")).length).toBeGreaterThan(0);
    await user.click(card.getByRole("button", { name: "Already done" }));
    expect(await card.findByText("Did it go through?")).toBeVisible();
  });
});

describe("the menu", () => {
  it("cancels a task only after a question", async () => {
    const mock = createMockApp();
    const task = blockedTask(mock, "bot_detection");
    const { user } = openItem(`task:${task.id}`, mock);
    await cardOf("Alder & Finch");
    await user.click(screen.getByRole("button", { name: "More" }));
    await user.click(await screen.findByRole("menuitem", { name: "Cancel task" }));
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Keep it" }),
    );
    expect(mock.store.tasks.find((t) => t.id === task.id)?.status).toBe("blocked");
    await user.click(screen.getByRole("button", { name: "More" }));
    await user.click(await screen.findByRole("menuitem", { name: "Cancel task" }));
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Cancel task" }),
    );
    await waitFor(() =>
      expect(mock.store.tasks.find((t) => t.id === task.id)?.status).toBe("cancelled"),
    );
  });

  it("skips an ID only after a question that says what is skipped", async () => {
    const mock = createMockApp();
    const task = blockedTask(mock, "id_upload");
    const { user } = openItem(`task:${task.id}`, mock);
    const card = within(await cardOf("ClearCheck"));
    expect(card.getByText("Only if you're OK sharing it.")).toBeVisible();
    await user.click(card.getByRole("button", { name: "Don't send ID" }));
    const dialog = within(await screen.findByRole("dialog"));
    expect(dialog.getByText("Skip this target?")).toBeVisible();
    await user.click(dialog.getByRole("button", { name: "Skip it" }));
    await waitFor(() =>
      expect(mock.store.tasks.find((t) => t.id === task.id)?.status).toBe("cancelled"),
    );
  });

  it("shows one row that leads to setting up an agent when none is connected", async () => {
    const mock = createMockApp();
    const { user } = openItem(taskKey(mock, "login_required"), mock);
    await cardOf("Lumen Data Partners");
    await user.click(screen.getByRole("button", { name: "More" }));
    expect(await screen.findByRole("menuitem", { name: "Set up an agent" })).toBeVisible();
    expect(screen.queryByRole("menuitem", { name: /Hand to an agent/ })).toBeNull();
  });

  it("hands a task to the only agent in one tap, with an undo that keeps it for the person", async () => {
    const mock = createMockApp();
    applyAgentPreset(mock.store, "one");
    const { user } = openItem(taskKey(mock, "login_required"), mock);
    await cardOf("Lumen Data Partners");
    await user.click(screen.getByRole("button", { name: "More" }));
    await waitFor(() =>
      expect(screen.getByRole("menuitem", { name: /Hand to an agent/ })).toBeEnabled(),
    );
    await user.click(screen.getByRole("menuitem", { name: /Hand to an agent/ }));
    const handed = () =>
      mock.store.tasks.find(
        (candidate) =>
          candidate.kind === "agent" &&
          candidate.targetId === "lumen-data-partners" &&
          candidate.status === "queued",
      );
    await waitFor(() => expect(handed()).toBeDefined());
    expect(screen.queryByRole("dialog")).toBeNull();
    await user.click(await screen.findByRole("button", { name: "Keep for me" }));
    await waitFor(() => expect(handed()?.assignment?.to).toEqual({ kind: "person" }));
    expect(await screen.findByText("Kept for you")).toBeVisible();
  });

  it("says why when the server refuses a one-tap hand-off, on the card", async () => {
    const mock = createMockApp();
    applyAgentPreset(mock.store, "one");
    refuse(mock, /\/hand-off$/, 409, "task_changed", "Someone else already took this task.");
    const { user } = openItem(taskKey(mock, "login_required"), mock);
    await cardOf("Lumen Data Partners");
    await user.click(screen.getByRole("button", { name: "More" }));
    await waitFor(() =>
      expect(screen.getByRole("menuitem", { name: /Hand to an agent/ })).toBeEnabled(),
    );
    await user.click(screen.getByRole("menuitem", { name: /Hand to an agent/ }));
    expect(await screen.findByText("Someone else already took this task.")).toBeVisible();
  });

  it("confirms a kept task after the card is gone, and says when the agent already has it", async () => {
    const mock = createMockApp();
    applyAgentPreset(mock.store, "one");
    const refusal = refuse(
      mock,
      /\/assign$/,
      409,
      "task_running",
      "An agent is working on this task.",
    );
    refusal.armed = false;
    const { user } = openItem(taskKey(mock, "login_required"), mock);
    await cardOf("Lumen Data Partners");
    await user.click(screen.getByRole("button", { name: "More" }));
    await waitFor(() =>
      expect(screen.getByRole("menuitem", { name: /Hand to an agent/ })).toBeEnabled(),
    );
    await user.click(screen.getByRole("menuitem", { name: /Hand to an agent/ }));
    const keep = await screen.findByRole("button", { name: "Keep for me" });
    expect(screen.queryByRole("article", { name: "Lumen Data Partners" })).toBeNull();
    refusal.armed = true;
    await user.click(keep);
    expect(await screen.findByText("Already started")).toBeVisible();
    expect(screen.getByText("Find it in Review, Agents.")).toBeVisible();
  });

  it("lets the person pick among several agents, and never offers doing it themselves", async () => {
    const mock = createMockApp();
    applyAgentPreset(mock.store, "several");
    const { user } = openItem(taskKey(mock, "login_required"), mock);
    await cardOf("Lumen Data Partners");
    await user.click(screen.getByRole("button", { name: "More" }));
    await waitFor(() =>
      expect(screen.getByRole("menuitem", { name: /Hand to an agent/ })).toBeEnabled(),
    );
    await user.click(screen.getByRole("menuitem", { name: /Hand to an agent/ }));
    const dialog = within(await screen.findByRole("dialog"));
    expect(
      dialog.getByText("The agent gets your name, email and what the page asks for."),
    ).toBeVisible();
    expect(dialog.queryByRole("radio", { name: /myself/ })).toBeNull();
    await user.click(await dialog.findByRole("radio", { name: /nick-pc-agent/ }));
    await user.click(dialog.getByRole("button", { name: "Hand over" }));
    await waitFor(() =>
      expect(
        mock.store.tasks.find(
          (candidate) =>
            candidate.kind === "agent" &&
            candidate.targetId === "lumen-data-partners" &&
            candidate.status === "queued",
        )?.assignment?.to,
      ).toEqual({ kind: "model", workerId: "nick-pc-agent" }),
    );
  });

  it("opens the request the task belongs to", async () => {
    const mock = createMockApp();
    const { user } = openItem(taskKey(mock, "captcha"), mock);
    await cardOf("FindRecord");
    await user.click(screen.getByRole("button", { name: "More" }));
    expect(await screen.findByRole("menuitem", { name: "Open request" })).toBeVisible();
  });

  it("hands a task the person took back to the only agent in one tap", async () => {
    const mock = createMockApp();
    applyAgentPreset(mock.store, "one");
    const mine = mock.store.tasks.find(
      (task) => task.status === "queued" && task.assignment?.to.kind === "person",
    );
    if (!mine) throw new Error("fixture");
    const { user } = openItem(`task:${mine.id}`, mock);
    await cardOf(mine.targetName ?? "");
    await user.click(screen.getByRole("button", { name: "More" }));
    await waitFor(() =>
      expect(screen.getByRole("menuitem", { name: /Hand to an agent/ })).toBeEnabled(),
    );
    await user.click(screen.getByRole("menuitem", { name: /Hand to an agent/ }));
    await waitFor(() => expect(mine.assignment).toBeNull());
  });
});

/** Makes the routes matching `pattern` answer an error while `armed` stays true. */
function refuse(mock: MockApp, pattern: RegExp, status: number, error: string, message: string) {
  const state = { armed: true };
  const handle = mock.handle.bind(mock);
  mock.handle = async (request) =>
    state.armed && request.method === "POST" && pattern.test(request.url)
      ? {
          status,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ error, message }),
        }
      : handle(request);
  return state;
}

describe("the end of the queue", () => {
  function emptied(mock: MockApp) {
    mock.store.tasks = mock.store.tasks.filter(
      (task) => task.kind === "scan" || task.status === "failed",
    );
    mock.store.matches = [];
    for (const request of mock.store.requests) {
      if (request.status === "needs_verification") request.status = "awaiting_reply";
    }
    return mock;
  }

  it("says nothing needs you from the start, and links what waits elsewhere", async () => {
    openItem(null, emptied(createMockApp()));
    expect(await screen.findByText("Nothing needs you.")).toBeVisible();
    expect(screen.getByRole("link", { name: /^Mail · \d+$/ })).toHaveAttribute(
      "href",
      "/review/mail",
    );
    expect(screen.getByRole("link", { name: /^Problems · \d+$/ })).toHaveAttribute(
      "href",
      "/review/problems",
    );
  });

  it("says all done after the last item, with the snoozed ones still to come back", async () => {
    const mock = emptied(createMockApp());
    const request = mock.store.requests.find((candidate) => candidate.channel === "form");
    if (!request) throw new Error("fixture");
    const lone = {
      ...blockedTaskFixture(mock),
      requestId: request.id,
    };
    mock.store.tasks.push(lone);
    const { user } = openItem(`task:${lone.id}`, mock);
    const card = within(await screen.findByRole("article"));
    await user.click(card.getByRole("button", { name: "Already done" }));
    await user.click(await card.findByRole("button", { name: "Yes" }));
    expect(await screen.findByText("All done.")).toBeVisible();
  });
});

function blockedTaskFixture(mock: MockApp): TaskSummary {
  const base = mock.store.tasks.find((task) => task.kind === "scan");
  if (!base) throw new Error("fixture");
  return {
    ...base,
    id: "tsk_lone",
    kind: "form",
    status: "blocked",
    blockedReason: "captcha",
    profileId: mock.store.profiles[0]?.id ?? null,
    targetName: "Lone Broker",
    hasScreenshot: false,
  };
}
