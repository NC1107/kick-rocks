import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
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

describe("the review queue", () => {
  it("opens on the first tab with something waiting and counts every tab", async () => {
    open();
    expect(await screen.findByRole("tab", { name: /Blocked/, selected: true })).toBeVisible();
    expect(screen.getByRole("tab", { name: /Records to confirm/ })).toHaveTextContent("3");
    expect(screen.getByRole("tab", { name: /More details asked/ })).toHaveTextContent("2");
    expect(screen.getByRole("tab", { name: /Unclassified mail/ })).toHaveTextContent("2");
    expect(screen.getByRole("tab", { name: /Failed/ })).toHaveTextContent("1");
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
    const task = await card(/HomeRecords, Submit form/);
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
    const task = await card(/ClearCheck, Submit form/);
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
    open("blocked");
    const task = await card(/ClearCheck, Submit form/);
    expect(await task.findByText(/Agent access is off/)).toBeVisible();
    expect(task.getByRole("button", { name: "Hand to an agent" })).toBeDisabled();
  });

  it("cancels a task only after a confirmation", async () => {
    const { user, mock } = open("blocked");
    const task = await card(/ClearCheck, Submit form/);
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
    const match = await card(/Jordan Example on NameLookup/);
    expect(match.getByText("Age 62")).toBeVisible();
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
    const match = await card(/Jordan Example on NameLookup/);
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

  it("classifies unclassified mail and can read the whole message first", async () => {
    const { user, mock } = open("mail");
    const message = await card("Your recent message");
    await user.click(message.getByRole("button", { name: "Read the whole message" }));
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
    expect(task.getByText("The site had a problem")).toBeVisible();
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

  it("shows a calm empty state when nothing is waiting", async () => {
    const mock = failing(/never/);
    mock.store.tasks = mock.store.tasks.filter((task) => task.status !== "blocked");
    open("blocked", mock);
    expect(await screen.findByText("Nothing is blocked")).toBeVisible();
  });

  it("says when the queue cannot load", async () => {
    open(undefined, failing(/\/api\/review/));
    expect(await screen.findByText("Could not load the review queue")).toBeVisible();
    expect(screen.getByRole("button", { name: "Try again" })).toBeVisible();
  });
});
