import { screen } from "@testing-library/react";
import { useLocation } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { renderPage } from "../../test/render.js";
import { ProfileSwitcher } from "./ProfileSwitcher.js";

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>;
}

describe("the profile switcher", () => {
  it("opens the profiles section of Settings from Manage profiles", async () => {
    const { user } = renderPage(
      <>
        <ProfileSwitcher />
        <Where />
      </>,
    );
    await user.click(await screen.findByRole("button", { name: /Switch profile/ }));
    await user.click(await screen.findByRole("menuitem", { name: "Manage profiles" }));
    expect(screen.getByTestId("where")).toHaveTextContent("/settings/profiles");
  });

  it("tells its container when another profile is picked, so a drawer can close", async () => {
    const onSwitch = vi.fn();
    const { user } = renderPage(<ProfileSwitcher onSwitch={onSwitch} />);
    await user.click(await screen.findByRole("button", { name: /Switch profile/ }));
    await user.click(await screen.findByRole("menuitemradio", { name: /Riley/ }));
    expect(onSwitch).toHaveBeenCalledTimes(1);
  });

  it("names the button from its content, so the accessible name holds everything it shows", async () => {
    renderPage(<ProfileSwitcher />);
    const button = await screen.findByRole("button", { name: /Switch profile/ });
    expect(button).not.toHaveAttribute("aria-label");
    const name = button.textContent ?? "";
    const visible = Array.from(button.querySelectorAll("span:not([aria-hidden]):not(.sr-only)"))
      .filter((span) => span.children.length === 0)
      .map((span) => span.textContent ?? "");
    expect(visible).toHaveLength(2);
    for (const text of visible) {
      expect(screen.getByRole("button", { name: new RegExp(text) })).toBe(button);
    }
    expect(name).toContain("Switch profile");
  });
});
