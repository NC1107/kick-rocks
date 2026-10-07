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
});
