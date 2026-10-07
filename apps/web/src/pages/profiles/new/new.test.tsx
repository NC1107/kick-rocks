import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderPage } from "../../../test/render.js";
import { instrument } from "../test-support.js";
import { Component as NewProfilePage } from "./index.js";

async function fillMinimum(user: ReturnType<typeof renderPage>["user"]) {
  await user.type(screen.getByLabelText("First name"), "Taylor");
  await user.type(screen.getByLabelText("Last name"), "Sample");
  await user.type(screen.getByLabelText("Email address"), "taylor@example.org");
  await user.selectOptions(screen.getByLabelText("State of residence"), "OR");
}

describe("the new profile page", () => {
  it("starts with one blank primary name and one blank primary email", () => {
    renderPage(<NewProfilePage />);
    const name = screen.getByRole("group", { name: "Name 1" });
    expect(within(name).getByText("Primary")).toBeInTheDocument();
    const email = screen.getByRole("group", { name: "Email 1" });
    expect(within(email).getByText("Primary")).toBeInTheDocument();
    expect(screen.getAllByText("None added.")).toHaveLength(4);
  });

  it("marks every missing field and sends nothing", async () => {
    const { user, mock } = renderPage(<NewProfilePage />);
    const seen = instrument(mock);
    await user.click(screen.getByRole("button", { name: "Create profile" }));

    expect(await screen.findByText("Choose a state")).toBeInTheDocument();
    expect(screen.getAllByText("Required").length).toBeGreaterThanOrEqual(3);
    expect(screen.getByLabelText("First name")).toBeInvalid();
    expect(screen.getByLabelText("Email address")).toBeInvalid();
    expect(seen.filter((request) => request.method === "POST")).toHaveLength(0);
  });

  it("does not demand a profile name that defaults to the primary name", async () => {
    const { user } = renderPage(<NewProfilePage />);
    await user.type(screen.getByLabelText("First name"), "Taylor");
    await user.type(screen.getByLabelText("Last name"), "Sample");
    await user.click(screen.getByRole("button", { name: "Create profile" }));
    expect(await screen.findByText("Choose a state")).toBeInTheDocument();
    expect(screen.getByLabelText("Profile name")).not.toBeInvalid();
  });

  it("clears each error once the field is fixed and focuses the first problem", async () => {
    const { user } = renderPage(<NewProfilePage />);
    await user.click(screen.getByRole("button", { name: "Create profile" }));
    await screen.findByText("Choose a state");
    expect(screen.getByLabelText("State of residence")).toHaveFocus();
    await fillMinimum(user);
    expect(screen.queryByText("Choose a state")).not.toBeInTheDocument();
    expect(screen.getByLabelText("First name")).not.toBeInvalid();
    expect(screen.getByLabelText("Email address")).not.toBeInvalid();
  });

  it("checks the email, phone, and ZIP before sending", async () => {
    const { user } = renderPage(<NewProfilePage />);
    await fillMinimum(user);
    await user.clear(screen.getByLabelText("Email address"));
    await user.type(screen.getByLabelText("Email address"), "not-an-email");
    await user.click(screen.getByRole("button", { name: "Add phone" }));
    await user.type(screen.getByLabelText("Phone number"), "12345");
    await user.click(screen.getByRole("button", { name: "Add address" }));
    await user.type(screen.getByLabelText("ZIP"), "12");
    await user.click(screen.getByRole("button", { name: "Create profile" }));

    expect(await screen.findByText("Enter a valid email address")).toBeInTheDocument();
    expect(screen.getByText(/area code/)).toBeInTheDocument();
    expect(screen.getByText(/5 digit ZIP/)).toBeInTheDocument();
  });

  it("creates the profile with the typed identities and makes it current", async () => {
    const { user, mock } = renderPage(<NewProfilePage />);
    const seen = instrument(mock);
    await fillMinimum(user);
    await user.click(screen.getByRole("button", { name: "Add phone" }));
    await user.type(screen.getByLabelText("Phone number"), "(555) 555-0199");
    await user.click(screen.getByRole("button", { name: "Create profile" }));

    expect(await screen.findByText("Created")).toBeInTheDocument();
    const post = seen.find(
      (request) => request.method === "POST" && request.url === "/api/profiles",
    );
    expect(post?.json).toMatchObject({
      displayName: "Taylor Sample",
      state: "OR",
      identities: [
        { kind: "name", value: { first: "Taylor", last: "Sample" }, isPrimary: true },
        { kind: "email", value: { address: "taylor@example.org" }, isPrimary: true },
        { kind: "phone", value: { number: "+15555550199" }, isPrimary: true },
      ],
    });
    const created = mock.store.profiles.at(-1);
    expect(created?.displayName).toBe("Taylor Sample");
    expect(created?.primaryEmail).toBe("taylor@example.org");
  });

  it("uses the profile name the person typed instead of the default", async () => {
    const { user, mock } = renderPage(<NewProfilePage />);
    await fillMinimum(user);
    await user.type(screen.getByLabelText("Profile name"), "Taylor at work");
    await user.click(screen.getByRole("button", { name: "Create profile" }));
    await screen.findByText("Created");
    expect(mock.store.profiles.at(-1)?.displayName).toBe("Taylor at work");
  });

  it("puts a server complaint on the field it names", async () => {
    const { user, mock } = renderPage(<NewProfilePage />);
    instrument(mock, {
      match: "POST /api/profiles",
      status: 400,
      body: {
        error: "invalid_request",
        message: "Some details are not valid.",
        issues: [
          { path: ["body", "identities", 1, "value", "address"], message: "Use a real address" },
        ],
      },
    });
    await fillMinimum(user);
    await user.click(screen.getByRole("button", { name: "Create profile" }));
    expect(await screen.findByText("Use a real address")).toBeInTheDocument();
    expect(screen.getByLabelText("Email address")).toBeInvalid();
    expect(screen.getByRole("button", { name: "Create profile" })).toBeEnabled();
  });

  it("shows a general failure when the server is down", async () => {
    const { user, mock } = renderPage(<NewProfilePage />);
    instrument(mock, {
      match: "POST /api/profiles",
      status: 403,
      body: { error: "forbidden", message: "That request was blocked." },
    });
    await fillMinimum(user);
    await user.click(screen.getByRole("button", { name: "Create profile" }));
    const alert = await screen.findByText("Could not create the profile");
    expect(alert.closest("[role=alert]")).toHaveTextContent("That request was blocked.");
  });

  it("rejects a birth date in the future", async () => {
    const { user } = renderPage(<NewProfilePage />);
    await fillMinimum(user);
    await user.click(screen.getByRole("button", { name: "Add date of birth" }));
    await user.type(screen.getByLabelText("Date of birth", { selector: "input" }), "2999-01-01");
    await user.click(screen.getByRole("button", { name: "Create profile" }));
    expect(await screen.findByText("Date of birth is not plausible")).toBeInTheDocument();
  });
});
