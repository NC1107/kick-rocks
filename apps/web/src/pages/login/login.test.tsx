import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderPage } from "../../test/render.js";
import { Component as LoginPage } from "./index.js";

describe("the sign in page", () => {
  it("tells a person the password is wrong, in a place a screen reader announces", async () => {
    const { user, mock } = renderPage(<LoginPage />, {
      mockOptions: { auth: "login" },
      withProfile: false,
    });
    await user.type(screen.getByLabelText("Password"), "not the password");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("That password is not right.");
    expect(mock.store.auth.authenticated).toBe(false);
  });

  it("signs in with the right password", async () => {
    const { user, mock } = renderPage(<LoginPage />, {
      mockOptions: { auth: "login" },
      withProfile: false,
    });
    await user.type(screen.getByLabelText("Password"), "kickrocks-mock");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    await screen.findByRole("button", { name: "Sign in" });
    expect(mock.store.auth.authenticated).toBe(true);
  });

  it("tells a person they are throttled after too many wrong passwords", async () => {
    const { user } = renderPage(<LoginPage />, {
      mockOptions: { auth: "login" },
      withProfile: false,
    });
    for (let attempt = 0; attempt < 5; attempt++) {
      await user.clear(screen.getByLabelText("Password"));
      await user.type(screen.getByLabelText("Password"), "wrong");
      await user.click(screen.getByRole("button", { name: "Sign in" }));
      await screen.findByText("That password is not right.");
    }
    await user.clear(screen.getByLabelText("Password"));
    await user.type(screen.getByLabelText("Password"), "kickrocks-mock");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(
      await screen.findByText("Too many attempts. Wait a minute, then try again."),
    ).toBeInTheDocument();
  });

  it("sends nothing when the password is empty", async () => {
    const { user, mock } = renderPage(<LoginPage />, {
      mockOptions: { auth: "login" },
      withProfile: false,
    });
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(mock.store.auth.failedLogins).toBe(0);
  });

  it("reveals what was typed on request", async () => {
    const { user } = renderPage(<LoginPage />, {
      mockOptions: { auth: "login" },
      withProfile: false,
    });
    const password = screen.getByLabelText("Password");
    await user.type(password, "secret");
    expect(password).toHaveAttribute("type", "password");
    await user.click(screen.getByRole("button", { name: "Show password" }));
    expect(password).toHaveAttribute("type", "text");
  });

  it("starts with the password field focused", () => {
    renderPage(<LoginPage />, { mockOptions: { auth: "login" }, withProfile: false });
    expect(screen.getByLabelText("Password")).toHaveFocus();
  });
});
