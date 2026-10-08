import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createMockApp } from "../../../mock/app.js";
import { renderPage } from "../../test/render.js";
import { Component as ProfilesPage } from "./index.js";
import { instrument } from "./test-support.js";

describe("the profiles list", () => {
  it("lists every profile with its state, email, and mailbox status", async () => {
    renderPage(<ProfilesPage />);
    const jordan = await screen.findByRole("listitem", { name: /Jordan Example/ });
    expect(within(jordan).getByText("CA")).toBeInTheDocument();
    expect(within(jordan).getByText("jordan@example.com")).toBeInTheDocument();
    expect(within(jordan).getByText("Mailbox connected")).toBeInTheDocument();
    const riley = screen.getByRole("listitem", { name: /Riley Sample/ });
    expect(within(riley).getByRole("link", { name: "Connect mailbox" })).toHaveAttribute(
      "href",
      expect.stringMatching(/\/profiles\/prf_\d+\/mailbox$/),
    );
  });

  it("marks the current profile and switches to another", async () => {
    const { user } = renderPage(<ProfilesPage />);
    const jordan = await screen.findByRole("listitem", { name: /Jordan Example/ });
    expect(within(jordan).getByText("Current")).toBeInTheDocument();
    expect(within(jordan).queryByRole("button", { name: "Make current" })).toBeNull();

    const riley = screen.getByRole("listitem", { name: /Riley Sample/ });
    await user.click(within(riley).getByRole("button", { name: "Make current" }));
    expect(
      within(screen.getByRole("listitem", { name: /Riley Sample/ })).getByText("Current"),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole("listitem", { name: /Jordan Example/ })).queryByText("Current"),
    ).toBeNull();
  });

  it("shows a skeleton while loading", () => {
    renderPage(<ProfilesPage />);
    expect(screen.getByText("Loading")).toBeInTheDocument();
  });

  it("asks before deleting, then removes the profile and says so", async () => {
    const { user, mock } = renderPage(<ProfilesPage />);
    const row = await screen.findByRole("listitem", { name: /Riley Sample/ });
    await user.click(within(row).getByRole("button", { name: "Delete Riley Sample" }));

    const dialog = await screen.findByRole("dialog", { name: "Delete Riley Sample?" });
    expect(mock.store.profiles).toHaveLength(3);
    await user.click(within(dialog).getByRole("button", { name: "Delete profile" }));

    expect(await screen.findByText("Deleted")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByRole("listitem", { name: /Riley Sample/ })).toBeNull(),
    );
    expect(mock.store.profiles.map((profile) => profile.displayName)).not.toContain("Riley Sample");
  });

  it("keeps the profile when the person cancels", async () => {
    const { user, mock } = renderPage(<ProfilesPage />);
    const row = await screen.findByRole("listitem", { name: /Riley Sample/ });
    await user.click(within(row).getByRole("button", { name: "Delete Riley Sample" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete Riley Sample?" });
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(mock.store.profiles).toHaveLength(3);
    expect(screen.getByRole("listitem", { name: /Riley Sample/ })).toBeInTheDocument();
  });

  it("explains an empty list and offers to create a profile", async () => {
    const mock = createMockApp();
    mock.store.profiles.length = 0;
    renderPage(<ProfilesPage />, { mock });
    expect(await screen.findByText("No profiles yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /New profile/ })).toHaveAttribute(
      "href",
      "/profiles/new",
    );
  });

  it("says what went wrong when profiles cannot load, and retries", async () => {
    const mock = createMockApp();
    instrument(mock, {
      match: "GET /api/profiles",
      status: 403,
      body: { error: "forbidden", message: "That request was blocked." },
    });
    const { user } = renderPage(<ProfilesPage />, { mock });
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Could not load profiles");
    expect(alert).toHaveTextContent("That request was blocked.");
    expect(within(alert).getByRole("button", { name: "Try again" })).toBeEnabled();
    await user.click(within(alert).getByRole("button", { name: "Try again" }));
  });

  it("shows a long name and email without breaking the row", async () => {
    renderPage(<ProfilesPage />);
    const row = await screen.findByRole("listitem", { name: /Alexandria Montgomery-Fitzgerald/ });
    expect(
      within(row).getByText("alexandria.montgomery-fitzgerald.example@subdomain.example.com"),
    ).toBeInTheDocument();
  });
});
