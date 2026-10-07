import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createMockApp } from "../../../mock/app.js";
import { renderPage } from "../../test/render.js";
import { instrument } from "../profiles/test-support.js";
import { Component as MailboxPage } from "./index.js";

/** Riley has no mailbox; Jordan has one on Fastmail. */
function open(who: "jordan" | "riley", mock = createMockApp()) {
  const profile = mock.store.profiles[who === "jordan" ? 0 : 1];
  if (!profile) throw new Error("fixture profile missing");
  const page = renderPage(<MailboxPage />, {
    mock,
    route: `/profiles/${profile.id}/mailbox`,
    path: "/profiles/:id/mailbox",
  });
  return { ...page, profile };
}

type User = ReturnType<typeof renderPage>["user"];

async function chooseProvider(user: User, name: RegExp) {
  await user.click(await screen.findByRole("radio", { name }));
  await user.click(screen.getByRole("button", { name: "Continue" }));
}

async function typeAddress(user: User, address: string) {
  const field = await screen.findByLabelText("Email address");
  await user.clear(field);
  await user.type(field, address);
}

async function signIn(user: User, password = "app-password") {
  await typeAddress(user, "riley@example.net");
  await user.type(screen.getByLabelText(/password/i), password);
  await user.click(screen.getByRole("button", { name: "Continue" }));
}

async function runTest(user: User) {
  await user.click(await screen.findByRole("button", { name: "Test connection" }));
}

describe("connecting a mailbox", () => {
  it("lists the providers that work and explains the one that does not", async () => {
    open("riley");
    expect(await screen.findByRole("radio", { name: /^Gmail/ })).toBeInTheDocument();
    for (const name of [
      /^Fastmail/,
      /^iCloud Mail/,
      /^Proton Mail Bridge/,
      /^mailbox\.org/,
      /^Zoho Mail/,
      /^Other provider/,
    ]) {
      expect(screen.getByRole("radio", { name })).toBeInTheDocument();
    }
    expect(screen.queryByRole("radio", { name: /Outlook/ })).toBeNull();
    const unsupported = screen.getByRole("region", { name: "Not supported yet" });
    expect(within(unsupported).getByText("Outlook.com")).toBeInTheDocument();
    expect(within(unsupported).getByText(/only through OAuth/)).toBeInTheDocument();
  });

  it("will not continue until a provider is chosen", async () => {
    open("riley");
    expect(await screen.findByRole("button", { name: "Continue" })).toBeDisabled();
  });

  it("gives app password guidance with a link that opens in a new tab", async () => {
    const { user } = open("riley");
    await chooseProvider(user, /^Gmail/);
    const link = await screen.findByRole("link", { name: /Create an app password for Gmail/ });
    expect(link).toHaveAttribute("href", "https://myaccount.google.com/apppasswords");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
    expect(screen.getByText(/two-step verification/)).toBeInTheDocument();
  });

  it("has no app password link for Proton Mail Bridge and says to use the bridge password", async () => {
    const { user } = open("riley");
    await chooseProvider(user, /^Proton Mail Bridge/);
    expect(await screen.findByText(/bridge password/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /app password/ })).toBeNull();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
  });

  it("starts from the profile's own email address and names each port by protocol", async () => {
    const { user, profile } = open("riley");
    await chooseProvider(user, /^Proton Mail Bridge/);
    expect(await screen.findByLabelText("Email address")).toHaveValue(profile.primaryEmail);
    await user.click(screen.getByRole("button", { name: "Server settings" }));
    expect(screen.getByLabelText("SMTP port")).toBeVisible();
    expect(screen.getByLabelText("IMAP port")).toBeVisible();
  });

  it("asks for the missing details before testing", async () => {
    const { user } = open("riley");
    await chooseProvider(user, /^Gmail/);
    await user.clear(await screen.findByLabelText("Email address"));
    await user.click(await screen.findByRole("button", { name: "Continue" }));
    expect(screen.getAllByText("Required")).toHaveLength(2);
    expect(screen.getByLabelText("Email address")).toBeInvalid();
  });

  it("opens the server settings for another provider and needs its hosts", async () => {
    const { user } = open("riley");
    await chooseProvider(user, /^Other provider/);
    expect(await screen.findByLabelText("Sending host (SMTP)")).toHaveValue("");
    await signIn(user);
    expect(screen.getAllByText("Required")).toHaveLength(2);
    await user.type(screen.getByLabelText("Sending host (SMTP)"), "smtp.example.test");
    await user.type(screen.getByLabelText("Receiving host (IMAP)"), "imap.example.test");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByRole("button", { name: "Test connection" })).toBeInTheDocument();
  });

  it("rejects a port outside the range", async () => {
    const { user } = open("riley");
    await chooseProvider(user, /^Gmail/);
    await typeAddress(user, "riley@example.net");
    await user.type(screen.getByLabelText(/password/i), "app-password");
    await user.click(screen.getByRole("button", { name: "Server settings" }));
    const port = screen.getByLabelText("SMTP port");
    await user.clear(port);
    await user.type(port, "70000");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByText("Use a port from 1 to 65535")).toBeInTheDocument();
  });

  it("shows a working connection per protocol and the folders found", async () => {
    const { user } = open("riley");
    await chooseProvider(user, /^Gmail/);
    await signIn(user);
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
    await runTest(user);
    const results = await screen.findByRole("list", { name: "Connection results" });
    await waitFor(() => expect(within(results).getByText("5 folders found")).toBeInTheDocument());
    expect(within(results).getByText("Sending (SMTP)")).toBeInTheDocument();
    expect(within(results).getByText("Connected")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled();
  });

  it("shows which protocol failed, what the server said, and what to do", async () => {
    const { user } = open("riley");
    await chooseProvider(user, /^Gmail/);
    await signIn(user, "no-imap");
    await runTest(user);
    const results = await screen.findByRole("list", { name: "Connection results" });
    const smtp = within(results).getByText("Sending (SMTP)").closest("li") as HTMLElement;
    const imap = within(results).getByText("Receiving (IMAP)").closest("li") as HTMLElement;
    await waitFor(() => expect(within(imap).getByText("Failed")).toBeInTheDocument());
    expect(within(smtp).getByText("Connected")).toBeInTheDocument();
    expect(within(imap).getByText("Login failed: invalid credentials.")).toBeInTheDocument();
    expect(within(imap).getByText(/Use an app password/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
  });

  it("explains a refused connection for Proton Mail Bridge", async () => {
    const { user } = open("riley");
    await chooseProvider(user, /^Proton Mail Bridge/);
    await signIn(user, "refused");
    await runTest(user);
    expect((await screen.findAllByText(/Start Proton Mail Bridge/)).length).toBe(2);
    expect(screen.getAllByText(/ECONNREFUSED 127\.0\.0\.1:1025/).length).toBeGreaterThan(0);
  });

  it("shows a failure to run the test at all", async () => {
    const mock = createMockApp();
    const { user } = open("riley", mock);
    instrument(mock, {
      match: "POST /api/profiles/",
      status: 403,
      body: { error: "forbidden", message: "That request was blocked." },
    });
    await chooseProvider(user, /^Gmail/);
    await signIn(user);
    await runTest(user);
    expect(await screen.findByText("That request was blocked.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
  });

  it("discards a passing result when the details change", async () => {
    const { user } = open("riley");
    await chooseProvider(user, /^Gmail/);
    await signIn(user);
    await runTest(user);
    await waitFor(() => expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled());

    await user.click(screen.getByRole("button", { name: "Back" }));
    const password = screen.getByLabelText(/password/i);
    await user.clear(password);
    await user.type(password, "another-password");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByRole("button", { name: "Test connection" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
  });

  it("saves the mailbox with the chosen folder and daily limit", async () => {
    const mock = createMockApp();
    const seen = instrument(mock);
    const { user, profile } = open("riley", mock);
    await chooseProvider(user, /^Gmail/);
    await signIn(user);
    await runTest(user);
    await waitFor(() => expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "Continue" }));

    const folder = await screen.findByLabelText("Reply folder");
    expect(folder).toHaveValue("Kick Rocks");
    expect(within(folder).getAllByRole("option")[0]).toHaveTextContent("Inbox");
    await user.selectOptions(folder, "INBOX");
    const cap = screen.getByLabelText("Daily limit");
    expect(cap).toHaveValue(100);
    await user.clear(cap);
    await user.type(cap, "60");
    await user.click(screen.getByRole("button", { name: "Save mailbox" }));

    expect(await screen.findByText("Saved")).toBeInTheDocument();
    expect(screen.getAllByText(/Next, start a campaign/).length).toBeGreaterThan(0);
    const put = seen.find((request) => request.method === "PUT");
    expect(put?.url).toBe(`/api/profiles/${profile.id}/mailbox`);
    expect(put?.json).toMatchObject({
      provider: "gmail",
      address: "riley@example.net",
      username: "riley@example.net",
      password: "app-password",
      smtpHost: "smtp.gmail.com",
      replyFolder: "INBOX",
      dailyCap: 60,
    });
    expect(mock.store.profiles[1]?.mailbox).toMatchObject({ dailyCap: 60, replyFolder: "INBOX" });
    expect(mock.store.profiles[1]?.mailboxConnected).toBe(true);
  });

  it("warns about a limit above the suggested one and rejects nonsense", async () => {
    const { user } = open("riley");
    await chooseProvider(user, /^Gmail/);
    await signIn(user);
    await runTest(user);
    await waitFor(() => expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "Continue" }));

    const cap = await screen.findByLabelText("Daily limit");
    await user.clear(cap);
    await user.type(cap, "400");
    expect(screen.getByText("Higher than the suggested limit")).toBeInTheDocument();
    await user.clear(cap);
    await user.type(cap, "0");
    await user.click(screen.getByRole("button", { name: "Save mailbox" }));
    expect(await screen.findByText(/whole number from 1 to 2000/)).toBeInTheDocument();
  });

  it("shows why a save failed and keeps the wizard open", async () => {
    const mock = createMockApp();
    const { user } = open("riley", mock);
    instrument(mock, {
      match: "PUT /api/profiles/",
      status: 400,
      body: {
        error: "invalid_request",
        message: "Some details are not valid.",
        issues: [{ path: ["body", "password"], message: "Enter the app password" }],
      },
    });
    await chooseProvider(user, /^Gmail/);
    await signIn(user);
    await runTest(user);
    await waitFor(() => expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.click(await screen.findByRole("button", { name: "Save mailbox" }));
    expect(await screen.findByText("Enter the app password")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save mailbox" })).toBeEnabled();
  });

  it("can go back through the steps without losing what was typed", async () => {
    const { user } = open("riley");
    await chooseProvider(user, /^Gmail/);
    await typeAddress(user, "riley@example.net");
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("radio", { name: /^Gmail/ })).toBeChecked();
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByLabelText("Email address")).toHaveValue("riley@example.net");
  });
});

describe("a connected mailbox", () => {
  it("shows the saved connection without the password", async () => {
    open("jordan");
    expect(await screen.findByRole("heading", { name: "Mailbox", level: 1 })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "jordan@example.com" })).toBeInTheDocument();
    expect(screen.getByText("Fastmail")).toBeInTheDocument();
    expect(screen.getByText("smtp.fastmail.com:465")).toBeInTheDocument();
    expect(screen.getByText("imap.fastmail.com:993")).toBeInTheDocument();
    expect(screen.getByText("Kick Rocks")).toBeInTheDocument();
    expect(screen.getByText("150 requests a day")).toBeInTheDocument();
    expect(screen.queryByText(/password/i)).toBeNull();
  });

  it("warns when the last check failed", async () => {
    const mock = createMockApp();
    const mailbox = mock.store.profiles[0]?.mailbox;
    if (mailbox) mailbox.lastError = "Login failed: invalid credentials.";
    open("jordan", mock);
    expect(await screen.findByText("The last check failed")).toBeInTheDocument();
    expect(screen.getByText("Login failed: invalid credentials.")).toBeInTheDocument();
  });

  it("says sending is paused, and until when, while the pause applies", async () => {
    const mock = createMockApp();
    const mailbox = mock.store.profiles[0]?.mailbox;
    if (mailbox) mailbox.sendPausedUntil = new Date(Date.now() + 25 * 60_000).toISOString();
    open("jordan", mock);
    expect(await screen.findByText("Sending is paused")).toBeInTheDocument();
    expect(screen.getByText("in 25m")).toBeInTheDocument();
  });

  it("says nothing about a pause that has ended or never was", async () => {
    const mock = createMockApp();
    const mailbox = mock.store.profiles[0]?.mailbox;
    if (mailbox) mailbox.sendPausedUntil = new Date(Date.now() - 60_000).toISOString();
    open("jordan", mock);
    await screen.findByRole("heading", { name: "jordan@example.com" });
    expect(screen.queryByText("Sending is paused")).toBeNull();
  });

  it("checks the inbox on request", async () => {
    const mock = createMockApp();
    const seen = instrument(mock);
    const { user, profile } = open("jordan", mock);
    await user.click(await screen.findByRole("button", { name: "Check inbox now" }));
    expect(await screen.findByText("Queued")).toBeInTheDocument();
    expect(seen.some((request) => request.url === `/api/profiles/${profile.id}/mailbox/poll`)).toBe(
      true,
    );
  });

  it("disconnects after a confirmation", async () => {
    const { user, mock } = open("jordan");
    await user.click(await screen.findByRole("button", { name: "Disconnect" }));
    const dialog = await screen.findByRole("dialog", { name: "Disconnect this mailbox?" });
    expect(mock.store.profiles[0]?.mailbox).not.toBeNull();
    await user.click(within(dialog).getByRole("button", { name: "Disconnect" }));
    expect(await screen.findByText("Disconnected")).toBeInTheDocument();
    expect(mock.store.profiles[0]?.mailbox).toBeNull();
  });

  it("edits the connection, keeping the saved password when none is typed", async () => {
    const mock = createMockApp();
    const seen = instrument(mock);
    const { user } = open("jordan", mock);
    await user.click(await screen.findByRole("button", { name: "Edit connection" }));

    expect(await screen.findByLabelText("Email address")).toHaveValue("jordan@example.com");
    expect(screen.getByText("Leave empty to keep the saved password.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await runTest(user);
    await waitFor(() => expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled());
    const test = seen.find((request) => request.url.endsWith("/mailbox/test"));
    expect(test?.json).not.toHaveProperty("password");

    await user.click(screen.getByRole("button", { name: "Continue" }));
    const folder = await screen.findByLabelText("Reply folder");
    expect(folder).toHaveValue("Kick Rocks");
    const cap = screen.getByLabelText("Daily limit");
    await user.clear(cap);
    await user.type(cap, "90");
    await user.click(screen.getByRole("button", { name: "Save mailbox" }));
    expect(await screen.findByText("Saved")).toBeInTheDocument();
    const put = seen.find((request) => request.method === "PUT");
    expect(put?.json).not.toHaveProperty("password");
    expect(mock.store.profiles[0]?.mailbox?.dailyCap).toBe(90);
  });

  it("returns to the summary when editing is cancelled", async () => {
    const { user } = open("jordan");
    await user.click(await screen.findByRole("button", { name: "Edit connection" }));
    await user.click(await screen.findByRole("button", { name: "Back" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(await screen.findByRole("button", { name: "Edit connection" })).toBeInTheDocument();
  });
});

describe("loading and failing", () => {
  it("shows a skeleton while the profile loads", () => {
    open("riley");
    expect(document.querySelector("[aria-busy=true]")).not.toBeNull();
  });

  it("explains a profile that does not exist", async () => {
    renderPage(<MailboxPage />, { route: "/profiles/nope/mailbox", path: "/profiles/:id/mailbox" });
    expect(await screen.findByText("That profile does not exist")).toBeInTheDocument();
  });

  it("offers a retry when the page cannot load", async () => {
    const mock = createMockApp();
    instrument(mock, {
      match: "GET /api/mail/providers",
      status: 403,
      body: { error: "forbidden", message: "That request was blocked." },
    });
    open("riley", mock);
    expect(await screen.findByText("Could not load the mailbox")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});
