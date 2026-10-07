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
});
