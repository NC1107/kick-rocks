import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createMockApp, type MockApp } from "../../../../mock/app.js";
import { renderPage } from "../../../test/render.js";
import { Component as NotificationsPage } from "./index.js";
import { checkMaxPerHour, checkNtfy, checkTelegram, ntfyDraftOf } from "./model.js";

const BOT_TOKEN = "123456789:AAExampleTokenValue_abcdefghijklmnop";

const page = (mock: MockApp = createMockApp()) =>
  renderPage(<NotificationsPage />, {
    path: "/settings/notifications",
    route: "/settings/notifications",
    mock,
  });

const field = (label: RegExp | string) => screen.findByLabelText(label);

/** Saves ntfy with the fields the mock needs, leaving the page ready for the next step. */
async function saveNtfy(user: ReturnType<typeof page>["user"], topic = "kr_alerts") {
  await user.type(await field("Topic"), topic);
  await user.click(screen.getByRole("button", { name: "Save ntfy" }));
  await screen.findAllByText("ntfy saved");
}

describe("notification settings page", () => {
  it("explains that no channel is set up yet", async () => {
    page();
    expect(await screen.findByText("No push channel yet")).toBeVisible();
    expect(await field("Server")).toHaveValue("https://ntfy.sh");
    expect(screen.getByRole("button", { name: "Save ntfy" })).toBeDisabled();
  });

  it("links to the notifications tab from the settings header", async () => {
    page();
    expect(await screen.findByRole("link", { name: "Notifications" })).toHaveAttribute(
      "href",
      "/settings/notifications",
    );
  });

  it("saves ntfy, keeps the token out of the form, and offers a test", async () => {
    const { user } = page();
    await user.type(await field("Topic"), "kr_alerts");
    await user.type(screen.getByLabelText(/Access token/), "tk_secret");
    await user.click(screen.getByRole("button", { name: "Save ntfy" }));

    expect((await screen.findAllByText("ntfy saved")).length).toBeGreaterThan(0);
    expect(await screen.findByText("A token is saved. Leave this blank to keep it.")).toBeVisible();
    expect(screen.getByLabelText(/Access token/)).toHaveValue("");

    await user.click(screen.getAllByRole("button", { name: "Send test" })[0] as HTMLElement);
    expect((await screen.findAllByText("Test sent to ntfy")).length).toBeGreaterThan(0);
  });

  it("only enables the test for what is saved", async () => {
    const { user } = page();
    const [ntfyTest] = await screen.findAllByRole("button", { name: "Send test" });
    expect(ntfyTest).toBeDisabled();
    await user.type(await field("Topic"), "kr_alerts");
    expect(ntfyTest).toBeDisabled();
  });

  it("shows why a test failed, without a token", async () => {
    const { user } = page();
    await saveNtfy(user, "refused");
    await user.click(screen.getAllByRole("button", { name: "Send test" })[0] as HTMLElement);
    expect(await screen.findByText("ntfy did not take the test")).toBeVisible();
    expect(screen.getByText("ntfy answered 403: forbidden")).toBeVisible();
  });

  it("explains a topic that is not allowed and does not send it", async () => {
    const { user } = page();
    await user.type(await field("Topic"), "no spaces");
    await user.click(screen.getByRole("button", { name: "Save ntfy" }));
    expect(await screen.findByText(/Use letters, digits, dashes and underscores/)).toBeVisible();
    expect(screen.queryByText("ntfy saved")).not.toBeInTheDocument();
  });

  it("removes ntfy after a confirmation", async () => {
    const { user } = page();
    await saveNtfy(user);
    const card = screen.getByRole("heading", { name: "ntfy" }).closest("section") as HTMLElement;
    await user.click(within(card).getByRole("button", { name: "Remove" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Remove" }));
    expect((await screen.findAllByText("ntfy removed")).length).toBeGreaterThan(0);
    await waitFor(() => expect(screen.getByLabelText("Topic")).toHaveValue(""));
  });

  it("saves Telegram and checks the token shape first", async () => {
    const { user } = page();
    await user.type(await field("Chat ID"), "42");
    await user.type(screen.getByLabelText("Bot token"), "nope");
    await user.click(screen.getByRole("button", { name: "Save Telegram" }));
    expect(await screen.findByText(/does not look like a bot token/)).toBeVisible();

    await user.clear(screen.getByLabelText("Bot token"));
    await user.type(screen.getByLabelText("Bot token"), BOT_TOKEN);
    await user.click(screen.getByRole("button", { name: "Save Telegram" }));
    expect((await screen.findAllByText("Telegram saved")).length).toBeGreaterThan(0);
    expect(await screen.findByText("A token is saved. Leave this blank to keep it.")).toBeVisible();
  });

  it("chooses what to be told about and the hourly limit", async () => {
    const { user } = page();
    const recipes = await screen.findByLabelText("A recipe breaks");
    expect(recipes).toBeChecked();
    await user.click(recipes);
    const limit = screen.getByLabelText(/Pushes per hour/);
    await user.clear(limit);
    await user.type(limit, "99");
    const card = screen
      .getByRole("heading", { name: "What to tell you about" })
      .closest("section") as HTMLElement;
    await user.click(within(card).getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Enter 1 to 60.")).toBeVisible();

    await user.clear(limit);
    await user.type(limit, "3");
    await user.click(within(card).getByRole("button", { name: "Save" }));
    expect((await screen.findAllByText("Notification settings saved")).length).toBeGreaterThan(0);
    await waitFor(() => expect(screen.getByLabelText("A recipe breaks")).not.toBeChecked());
    expect(screen.getByLabelText(/Pushes per hour/)).toHaveValue(3);
  });

  it("schedules a weekly digest and enables the day only for weekly", async () => {
    const { user } = page();
    const how = await field("How often");
    expect(screen.getByLabelText("On")).toBeDisabled();
    await user.selectOptions(how, "weekly");
    expect(screen.getByLabelText("On")).toBeEnabled();
    await user.selectOptions(screen.getByLabelText("On"), "5");
    await user.selectOptions(screen.getByLabelText("At"), "18");
    await user.click(screen.getByRole("button", { name: "Save digest" }));
    expect((await screen.findAllByText("Digest saved")).length).toBeGreaterThan(0);
    await waitFor(() => expect(screen.getByLabelText("How often")).toHaveValue("weekly"));
    expect(screen.getByLabelText("On")).toHaveValue("5");
    expect(screen.getByLabelText("At")).toHaveValue("18");
  });

  it("sends a digest now and says so", async () => {
    const { user } = page();
    await user.click(await screen.findByRole("button", { name: "Send one now" }));
    expect(await screen.findByText("Digest sent to your mailbox.")).toBeVisible();
  });

  it("warns that the digest needs a mailbox and does not offer to send without one", async () => {
    const mock = createMockApp();
    mock.store.profiles.length = 0;
    page(mock);
    expect(await screen.findByText("No mailbox yet")).toBeVisible();
    expect(screen.getByRole("button", { name: "Send one now" })).toBeDisabled();
  });

  it("shows the last failure on a channel", async () => {
    const mock = createMockApp();
    const handle = mock.handle.bind(mock);
    mock.handle = async (request) => {
      const response = await handle(request);
      if (!request.url.endsWith("/notifications") || request.method !== "GET") return response;
      const body = JSON.parse(response.body as string);
      body.status.lastError = "ntfy answered 500";
      return { ...response, body: JSON.stringify(body) };
    };
    page(mock);
    expect(await screen.findByText("The last push did not go through")).toBeVisible();
    expect(screen.getByText("ntfy answered 500")).toBeVisible();
  });

  it("says when the settings cannot be loaded", async () => {
    const mock = createMockApp();
    mock.handle = async () => ({
      status: 403,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ error: "forbidden", message: "Blocked for the test." }),
    });
    page(mock);
    expect(await screen.findByText("Could not load notification settings")).toBeVisible();
  });
});

describe("notification form checks", () => {
  it("accepts a topic and a server, and sends a token only when it was typed", () => {
    const draft = { ...ntfyDraftOf(null), topic: "kr_alerts" };
    expect(checkNtfy(draft)).toEqual({
      errors: {},
      patch: { serverUrl: "https://ntfy.sh", topic: "kr_alerts" },
    });
    expect(checkNtfy({ ...draft, token: " tk " }).patch).toMatchObject({ token: "tk" });
    expect(checkNtfy({ ...draft, clearToken: true }).patch).toMatchObject({ token: null });
  });

  it.each([
    ["a javascript address", { serverUrl: "javascript:alert(1)", topic: "kr" }, "serverUrl"],
    ["an empty topic", { serverUrl: "https://ntfy.sh", topic: " " }, "topic"],
    ["a topic with a slash", { serverUrl: "https://ntfy.sh", topic: "a/b" }, "topic"],
  ])("refuses %s", (_name, fields, key) => {
    expect(Object.keys(checkNtfy({ ...ntfyDraftOf(null), ...fields }).errors)).toEqual([key]);
  });

  it("needs a bot token only when none is saved", () => {
    expect(checkTelegram({ botToken: "", chatId: "42" }, null).errors).toHaveProperty("botToken");
    expect(
      checkTelegram({ botToken: "", chatId: "42" }, { chatId: "42", botTokenSet: true }),
    ).toEqual({
      errors: {},
      patch: { chatId: "42" },
    });
  });

  it("limits the hourly count to 1 through 60", () => {
    expect(checkMaxPerHour("6")).toEqual({ value: 6 });
    expect(checkMaxPerHour("0").error).toBeDefined();
    expect(checkMaxPerHour("61").error).toBeDefined();
    expect(checkMaxPerHour("1.5").error).toBeDefined();
    expect(checkMaxPerHour("").error).toBeDefined();
  });
});
