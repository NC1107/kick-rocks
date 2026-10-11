import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderPage } from "../../../test/render.js";
import { Component as RemovePage } from "./index.js";

const open = (id: string) =>
  renderPage(<RemovePage />, { path: "/targets/:id/remove", route: `/targets/${id}/remove` });

describe("the remove-my-data screen for one target", () => {
  it("shows the rights, the email, the legal basis and a Send button, with no campaign groups", async () => {
    open("creditlens-data");
    expect(
      await screen.findByRole("heading", { name: "Remove my data from CreditLens Data", level: 1 }),
    ).toBeVisible();
    expect(screen.getByRole("checkbox", { name: /Opt out of sale/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /Delete my data/ })).not.toBeChecked();
    expect(await screen.findByText("Subject")).toBeVisible();
    expect(await screen.findByText(/must answer within \d+ days/)).toBeVisible();
    expect(screen.getByRole("button", { name: "Send request" })).toBeEnabled();
    expect(screen.queryByText("Easy ones")).not.toBeInTheDocument();
  });

  it("goes back to the target, not the campaign builder", async () => {
    open("creditlens-data");
    expect(await screen.findByRole("link", { name: "CreditLens Data" })).toHaveAttribute(
      "href",
      "/targets/creditlens-data",
    );
  });

  it("warns that a form-only target is a form", async () => {
    open("quillnote");
    expect(await screen.findByText("Web form only")).toBeVisible();
    expect(screen.queryByText("Subject")).not.toBeInTheDocument();
  });

  it("warns that a target asks for ID", async () => {
    open("creditlens-data");
    expect(await screen.findByText("Asks for ID")).toBeVisible();
  });

  it("sends one request after a confirmation", async () => {
    const { user, mock } = open("creditlens-data");
    const before = mock.store.requests.length;
    const send = await screen.findByRole("button", { name: "Send request" });
    await waitFor(() => expect(send).toBeEnabled());
    await user.click(send);
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Send request" }));
    await waitFor(() => expect(mock.store.requests.length).toBe(before + 1));
  });

  it("will not send with no right chosen", async () => {
    const { user } = open("creditlens-data");
    await user.click(await screen.findByRole("checkbox", { name: /Opt out of sale/ }));
    expect(screen.getByRole("button", { name: "Send request" })).toBeDisabled();
    expect(screen.getByText("Choose at least one.")).toBeVisible();
  });
});
