import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createMockApp } from "../../../mock/app.js";
import { renderPage } from "../../test/render.js";
import { instrument } from "../profiles/test-support.js";
import { Component as SetupPage } from "./index.js";

function open() {
  return renderPage(<SetupPage />, { mockOptions: { auth: "setup" }, withProfile: false });
}

describe("the setup page", () => {
  it("rejects a short password and says how long it must be", async () => {
    const { user, mock } = open();
    await user.type(screen.getByLabelText("Password"), "too short");
    await user.type(screen.getByLabelText("Confirm password"), "too short");
    await user.click(screen.getByRole("button", { name: "Set password" }));
    expect(await screen.findByText("Use at least 12 characters.")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInvalid();
    expect(mock.store.auth.setupRequired).toBe(true);
  });

  it("rejects passwords that do not match", async () => {
    const { user, mock } = open();
    await user.type(screen.getByLabelText("Password"), "a long enough password");
    await user.type(screen.getByLabelText("Confirm password"), "a different long password");
    await user.click(screen.getByRole("button", { name: "Set password" }));
    expect(await screen.findByText("The two passwords do not match.")).toBeInTheDocument();
    expect(screen.getByLabelText("Confirm password")).toBeInvalid();
    expect(mock.store.auth.setupRequired).toBe(true);
  });

  it("sets the password and signs in", async () => {
    const { user, mock } = open();
    await user.type(screen.getByLabelText("Password"), "a long enough password");
    await user.type(screen.getByLabelText("Confirm password"), "a long enough password");
    await user.click(screen.getByRole("button", { name: "Set password" }));
    await screen.findByRole("button", { name: "Set password" });
    await waitFor(() => expect(mock.store.auth.authenticated).toBe(true));
    expect(mock.store.auth.password).toBe("a long enough password");
    expect(mock.store.auth.setupRequired).toBe(false);
  });

  it("reveals and hides what was typed", async () => {
    const { user } = open();
    const password = screen.getByLabelText("Password");
    await user.type(password, "visible words");
    expect(password).toHaveAttribute("type", "password");
    await user.click(screen.getByRole("button", { name: "Show password" }));
    expect(password).toHaveAttribute("type", "text");
    await user.click(screen.getByRole("button", { name: "Hide password" }));
    expect(password).toHaveAttribute("type", "password");
  });

  it("shows the server's reason when it refuses", async () => {
    const mock = createMockApp({ auth: "setup" });
    instrument(mock, {
      match: "POST /api/auth/setup",
      status: 409,
      body: { error: "conflict", message: "This instance already has a password." },
    });
    const { user } = renderPage(<SetupPage />, { mock, withProfile: false });
    await user.type(screen.getByLabelText("Password"), "a long enough password");
    await user.type(screen.getByLabelText("Confirm password"), "a long enough password");
    await user.click(screen.getByRole("button", { name: "Set password" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This instance already has a password.",
    );
  });

  it("puts a server complaint about the password on the field", async () => {
    const mock = createMockApp({ auth: "setup" });
    instrument(mock, {
      match: "POST /api/auth/setup",
      status: 400,
      body: {
        error: "invalid_request",
        message: "Some details are not valid.",
        issues: [{ path: ["body", "password"], message: "That password is too common" }],
      },
    });
    const { user } = renderPage(<SetupPage />, { mock, withProfile: false });
    await user.type(screen.getByLabelText("Password"), "a long enough password");
    await user.type(screen.getByLabelText("Confirm password"), "a long enough password");
    await user.click(screen.getByRole("button", { name: "Set password" }));
    expect(await screen.findByText("That password is too common")).toBeInTheDocument();
  });
});
