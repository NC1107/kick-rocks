import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createMockApp } from "../../../mock/app.js";
import { renderPage } from "../../test/render.js";
import { RestoreBanner } from "./RestoreBanner.js";

describe("the restore banner", () => {
  it("shows nothing on an instance that was not restored", async () => {
    const mock = createMockApp();
    renderPage(<RestoreBanner />, { mock, withProfile: false });
    await new Promise((done) => setTimeout(done, 50));
    expect(screen.queryByText("Sending is paused after the restore")).not.toBeInTheDocument();
  });

  it("says sending is paused while the Sent folders are checked, with no way to skip the check", async () => {
    const mock = createMockApp();
    mock.store.health = "restore";
    renderPage(<RestoreBanner />, { mock, withProfile: false });
    expect(await screen.findByText("Sending is paused after the restore")).toBeInTheDocument();
    expect(screen.getByText(/Checking each mailbox's Sent folder/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Resume sending" })).not.toBeInTheDocument();
  });

  it("gives the reason and asks for a confirmation before sending resumes", async () => {
    const mock = createMockApp();
    mock.store.health = "restore_problem";
    const { user } = renderPage(<RestoreBanner />, { mock, withProfile: false });
    expect(await screen.findByText(/reports no Sent folder to check/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Resume sending" }));
    expect(mock.store.health).toBe("restore_problem");
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Resume sending" }));

    await waitFor(() => expect(mock.store.health).toBe("ok"));
    await waitFor(() =>
      expect(screen.queryByText("Sending is paused after the restore")).not.toBeInTheDocument(),
    );
  });
});
