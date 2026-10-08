import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderPage } from "../../test/render.js";
import { ProfileSwitcher } from "./ProfileSwitcher.js";

describe("the profile switcher", () => {
  it("tells its container when another profile is picked, so a drawer can close", async () => {
    const onSwitch = vi.fn();
    const { user } = renderPage(<ProfileSwitcher onSwitch={onSwitch} />);
    await user.click(await screen.findByRole("button", { name: /Switch profile/ }));
    await user.click(await screen.findByRole("menuitemradio", { name: /Riley/ }));
    expect(onSwitch).toHaveBeenCalledTimes(1);
  });

  it("names the button with everything it shows, so voice control can click it", async () => {
    renderPage(<ProfileSwitcher />);
    const button = await screen.findByRole("button", { name: /Switch profile/ });
    const visible = Array.from(button.querySelectorAll("span:not([aria-hidden])"))
      .filter((span) => span.children.length === 0)
      .map((span) => span.textContent ?? "");
    expect(visible).toHaveLength(2);
    for (const text of visible) {
      expect(button.getAttribute("aria-label")).toContain(text);
    }
  });
});
