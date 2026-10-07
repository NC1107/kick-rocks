import { screen, waitFor, within } from "@testing-library/react";
import { Link } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMockApp } from "../../../../mock/app.js";
import { renderPage } from "../../../test/render.js";
import { instrument } from "../test-support.js";
import { Component as ProfileDetailPage } from "./index.js";

function open(mock = createMockApp(), index = 0) {
  const profile = mock.store.profiles[index];
  if (!profile) throw new Error("fixture profile missing");
  const page = renderPage(<ProfileDetailPage />, {
    mock,
    route: `/profiles/${profile.id}`,
    path: "/profiles/:id",
  });
  return { ...page, profile };
}

/** jsdom has no object URLs and does not download, so this records what a download would have saved. */
function captureDownloads() {
  const saved: { name: string; blob: Blob }[] = [];
  const blobs = new Map<string, Blob>();
  let next = 0;
  Object.assign(URL, {
    createObjectURL: (blob: Blob) => {
      const url = `blob:test/${next++}`;
      blobs.set(url, blob);
      return url;
    },
    revokeObjectURL: () => undefined,
  });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    saved.push({ name: this.download, blob: blobs.get(this.href) as Blob });
  });
  return saved;
}

afterEach(() => {
  Reflect.deleteProperty(URL, "createObjectURL");
  Reflect.deleteProperty(URL, "revokeObjectURL");
  vi.restoreAllMocks();
});

async function savedJson(saved: { blob: Blob }[]) {
  const blob = saved[0]?.blob;
  if (!blob) throw new Error("nothing was saved");
  return JSON.parse(await blob.text());
}

describe("exporting a profile", () => {
  it("saves the profile's data as a JSON file named for it", async () => {
    const saved = captureDownloads();
    const { user, profile } = open();
    await user.click(await screen.findByRole("button", { name: "Export profile data" }));

    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]?.name).toMatch(/^kickrocks-jordan-example-\d{4}-\d{2}-\d{2}\.json$/);
    const file = await savedJson(saved);
    expect(file).toMatchObject({
      format: "kickrocks-profile-export",
      profile: { id: profile.id, displayName: "Jordan Example" },
    });
    expect(file.identities.length).toBeGreaterThan(0);
    expect((await screen.findAllByText("Export ready")).length).toBeGreaterThan(0);
  });

  it("includes the profile's requests with their timelines", async () => {
    const saved = captureDownloads();
    const mock = createMockApp();
    const profile = mock.store.profiles[0];
    const owned = mock.store.requests.filter((request) => request.profileId === profile?.id);
    expect(owned.length).toBeGreaterThan(0);
    const { user } = open(mock);
    await user.click(await screen.findByRole("button", { name: "Export profile data" }));
    await waitFor(() => expect(saved).toHaveLength(1));
    const file = await savedJson(saved);
    expect(file.requests.map((request: { id: string }) => request.id).sort()).toEqual(
      owned.map((request) => request.id).sort(),
    );
    expect(file.requests[0].events.length).toBeGreaterThan(0);
  });

  it("says so when the export fails, and saves nothing", async () => {
    const saved = captureDownloads();
    const mock = createMockApp();
    instrument(mock, {
      match: `GET /api/profiles/${mock.store.profiles[0]?.id}/export`,
      status: 403,
      body: { error: "forbidden", message: "That request was blocked." },
    });
    const { user } = open(mock);
    await user.click(await screen.findByRole("button", { name: "Export profile data" }));
    expect(await screen.findByText("Could not export")).toBeVisible();
    expect(saved).toHaveLength(0);
  });
});

describe("the profile page", () => {
  it("asks before an in-app move throws unsaved edits away", async () => {
    const mock = createMockApp();
    const profile = mock.store.profiles[0];
    const { user } = renderPage(
      <>
        <ProfileDetailPage />
        <Link to="/away">Away</Link>
      </>,
      { mock, route: `/profiles/${profile?.id}`, path: "/profiles/:id" },
    );
    await user.type(await screen.findByLabelText("Profile name"), " Two");
    await user.click(screen.getByRole("link", { name: "Away" }));
    const dialog = within(await screen.findByRole("dialog"));
    expect(dialog.getByText("Leave without saving?")).toBeVisible();
    await user.click(dialog.getByRole("button", { name: "Keep editing" }));
    expect(screen.queryByText("Away page")).not.toBeInTheDocument();
    await user.click(screen.getByRole("link", { name: "Away" }));
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Discard and leave" }),
    );
    expect(await screen.findByText("Away page")).toBeVisible();
  });

  it("lets an in-app move through when nothing was changed", async () => {
    const mock = createMockApp();
    const profile = mock.store.profiles[0];
    const { user } = renderPage(
      <>
        <ProfileDetailPage />
        <Link to="/away">Away</Link>
      </>,
      { mock, route: `/profiles/${profile?.id}`, path: "/profiles/:id" },
    );
    await screen.findByLabelText("Profile name");
    await user.click(screen.getByRole("link", { name: "Away" }));
    expect(await screen.findByText("Away page")).toBeVisible();
  });

  it("shows every stored identity grouped by kind, with the primary marked", async () => {
    open();
    expect(
      await screen.findByRole("heading", { name: "Jordan Example", level: 1 }),
    ).toBeInTheDocument();

    const name = screen.getByRole("group", { name: "Name 1" });
    expect(within(name).getByLabelText("First name")).toHaveValue("Jordan");
    expect(within(name).getByLabelText(/Middle name/)).toHaveValue("Q");
    expect(within(name).getByText("Primary")).toBeInTheDocument();

    expect(
      within(screen.getByRole("group", { name: "Alias 1" })).getByLabelText("First name"),
    ).toHaveValue("Jordie");
    const emails = [
      screen.getByRole("group", { name: "Email 1" }),
      screen.getByRole("group", { name: "Email 2" }),
    ];
    expect(within(emails[0] as HTMLElement).getByText("Primary")).toBeInTheDocument();
    expect(
      within(emails[1] as HTMLElement).getByRole("button", { name: "Make primary" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Phone number")).toHaveValue("+15555550123");
    expect(screen.getByLabelText("Date of birth", { selector: "input" })).toHaveValue("1990-04-12");
  });

  it("keeps the date range of each address", async () => {
    open();
    await screen.findByRole("group", { name: "Address 1" });
    const current = screen.getByRole("group", { name: "Address 1" });
    expect(within(current).getByLabelText(/Lived here from/)).toHaveValue("2022-03-01");
    expect(within(current).getByLabelText(/Until/)).toHaveValue("");
    const past = screen.getByRole("group", { name: "Address 2" });
    expect(within(past).getByLabelText(/Lived here from/)).toHaveValue("2017-06-01");
    expect(within(past).getByLabelText(/Until/)).toHaveValue("2022-02-28");
    expect(within(past).getByLabelText("State")).toHaveValue("CA");
  });

  it("only offers one date of birth", async () => {
    open();
    await screen.findByRole("group", { name: "Date of birth 1" });
    expect(screen.queryByRole("button", { name: "Add date of birth" })).toBeNull();
  });

  it("enables saving only once something changed, and discards edits", async () => {
    const { user } = open();
    const save = await screen.findByRole("button", { name: "Save identities" });
    expect(save).toBeDisabled();
    const first = within(screen.getByRole("group", { name: "Name 1" })).getByLabelText(
      "First name",
    );
    await user.type(first, "x");
    expect(save).toBeEnabled();
    const [, discard] = screen.getAllByRole("button", { name: "Discard changes" });
    await user.click(discard as HTMLElement);
    expect(first).toHaveValue("Jordan");
    expect(save).toBeDisabled();
  });

  it("saves edits to every kind of identity in one replace call", async () => {
    const { user, mock, profile } = open();
    const seen = instrument(mock);
    await screen.findByRole("group", { name: "Name 1" });

    await user.click(screen.getByRole("button", { name: "Add email" }));
    const third = screen.getByRole("group", { name: "Email 3" });
    await user.type(within(third).getByLabelText("Email address"), "jordan.new@example.net");
    await user.click(within(third).getByRole("button", { name: "Make primary" }));

    await user.click(screen.getByRole("button", { name: "Add alias" }));
    const alias = screen.getByRole("group", { name: "Alias 2" });
    expect(within(alias).queryByText("Primary")).toBeNull();
    expect(within(alias).queryByRole("button", { name: "Make primary" })).toBeNull();
    await user.type(within(alias).getByLabelText("First name"), "J");
    await user.type(within(alias).getByLabelText("Last name"), "Example");

    await user.click(screen.getByRole("button", { name: "Remove address 2" }));
    await user.click(screen.getByRole("button", { name: "Save identities" }));

    expect(await screen.findByText("Identities updated.")).toBeInTheDocument();
    const put = seen.find((request) => request.method === "PUT");
    expect(put?.url).toBe(`/api/profiles/${profile.id}/identities`);

    const stored = mock.store.profiles[0];
    expect(stored?.primaryEmail).toBe("jordan.new@example.net");
    expect(stored?.identities.filter((identity) => identity.kind === "address")).toHaveLength(1);
    expect(stored?.identities.filter((identity) => identity.kind === "alias")).toHaveLength(2);
    const primaries = stored?.identities.filter(
      (identity) => identity.kind === "email" && identity.isPrimary,
    );
    expect(primaries).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Save identities" })).toBeDisabled();
  });

  it("promotes another email when the primary is removed", async () => {
    const { user, mock } = open();
    await screen.findByRole("group", { name: "Email 1" });
    await user.click(screen.getByRole("button", { name: "Remove email 1" }));
    const remaining = screen.getByRole("group", { name: "Email 1" });
    expect(within(remaining).getByText("Primary")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save identities" }));
    await screen.findByText("Identities updated.");
    expect(mock.store.profiles[0]?.primaryEmail).toBe("j.example@example.org");
  });

  it("refuses to save with no email and says where to add one", async () => {
    const { user, mock } = open(createMockApp(), 1);
    const seen = instrument(mock);
    await screen.findByRole("group", { name: "Email 1" });
    await user.click(screen.getByRole("button", { name: "Remove email 1" }));
    await user.click(screen.getByRole("button", { name: "Save identities" }));
    expect(await screen.findByText("Add at least one email address.")).toBeInTheDocument();
    expect(seen.filter((request) => request.method === "PUT")).toHaveLength(0);
  });

  it("marks a half-typed address and an end date before the start", async () => {
    const { user } = open();
    await screen.findByRole("group", { name: "Address 1" });
    await user.click(screen.getByRole("button", { name: "Add address" }));
    const added = screen.getByRole("group", { name: "Address 3" });
    await user.type(within(added).getByLabelText("Street"), "5 Example Road");
    await user.type(within(added).getByLabelText(/Lived here from/), "2020-05-01");
    await user.type(within(added).getByLabelText(/Until/), "2019-01-01");
    await user.click(screen.getByRole("button", { name: "Save identities" }));
    expect(await within(added).findByText("Must not be before the start date")).toBeInTheDocument();
    expect(within(added).getByLabelText("City")).toBeInvalid();
    expect(within(added).getByLabelText("State")).toBeInvalid();
  });

  it("shows a server rejection on the field and keeps the edits", async () => {
    const { user, mock, profile } = open();
    instrument(mock, {
      match: `PUT /api/profiles/${profile.id}/identities`,
      status: 400,
      body: {
        error: "invalid_request",
        message: "Some details are not valid.",
        issues: [
          { path: ["body", "identities", 3, "value", "address"], message: "That address bounces" },
        ],
      },
    });
    await screen.findByRole("group", { name: "Email 2" });
    const second = screen.getByRole("group", { name: "Email 2" });
    await user.type(within(second).getByLabelText("Email address"), "x");
    await user.click(screen.getByRole("button", { name: "Save identities" }));
    expect(await screen.findByText("That address bounces")).toBeInTheDocument();
    expect(screen.getByText("Could not save identities")).toBeInTheDocument();
    expect(within(second).getByLabelText("Email address")).toHaveValue("j.example@example.orgx");
  });

  it("renames the profile and changes its state", async () => {
    const { user, mock } = open();
    await screen.findByRole("group", { name: "Name 1" });
    const name = screen.getByLabelText("Profile name");
    await user.clear(name);
    await user.type(name, "Jordan at home");
    await user.selectOptions(screen.getByLabelText("State of residence"), "OR");
    await user.click(screen.getByRole("button", { name: "Save profile" }));
    expect(await screen.findByText("Profile details updated.")).toBeInTheDocument();
    expect(mock.store.profiles[0]).toMatchObject({ displayName: "Jordan at home", state: "OR" });
  });

  it("will not save an empty profile name", async () => {
    const { user, mock } = open();
    const seen = instrument(mock);
    await screen.findByRole("group", { name: "Name 1" });
    await user.clear(screen.getByLabelText("Profile name"));
    await user.click(screen.getByRole("button", { name: "Save profile" }));
    expect(await screen.findByText("Required")).toBeInTheDocument();
    expect(seen.filter((request) => request.method === "PATCH")).toHaveLength(0);
  });

  it("shows the mailbox, and the way to connect one when there is none", async () => {
    const connected = open();
    expect(await screen.findByText("smtp.fastmail.com:465")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Manage mailbox" })).toBeInTheDocument();
    connected.unmount();

    open(createMockApp(), 1);
    expect(await screen.findByRole("link", { name: "Connect a mailbox" })).toHaveAttribute(
      "href",
      expect.stringMatching(/\/mailbox$/),
    );
  });

  it("warns when the mailbox has a problem", async () => {
    const mock = createMockApp();
    const mailbox = mock.store.profiles[0]?.mailbox;
    if (mailbox) mailbox.lastError = "Login failed: invalid credentials.";
    open(mock);
    expect(await screen.findByText("Login failed: invalid credentials.")).toBeInTheDocument();
  });

  it("deletes the profile after a confirmation", async () => {
    const { user, mock } = open(createMockApp(), 1);
    await screen.findByRole("group", { name: "Name 1" });
    await user.click(screen.getByRole("button", { name: "Delete profile" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete Riley Sample?" });
    await user.click(within(dialog).getByRole("button", { name: "Delete profile" }));
    expect(await screen.findByText("Deleted")).toBeInTheDocument();
    await waitFor(() => expect(mock.store.profiles).toHaveLength(2));
  });

  it("explains a profile that does not exist", async () => {
    renderPage(<ProfileDetailPage />, { route: "/profiles/nope", path: "/profiles/:id" });
    expect(await screen.findByText("That profile does not exist")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to profiles" })).toBeInTheDocument();
  });

  it("offers a retry when the profile cannot load", async () => {
    const mock = createMockApp();
    instrument(mock, {
      match: "GET /api/profiles/",
      status: 403,
      body: { error: "forbidden", message: "That request was blocked." },
    });
    const id = mock.store.profiles[0]?.id ?? "";
    renderPage(<ProfileDetailPage />, { mock, route: `/profiles/${id}`, path: "/profiles/:id" });
    expect(await screen.findByText("Could not load this profile")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});
