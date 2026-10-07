import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Menu, type MenuItem } from "./Menu.js";

function setup(items: MenuItem[]) {
  const user = userEvent.setup();
  render(
    <Menu
      items={items}
      trigger={(props) => (
        <button type="button" {...props}>
          Actions
        </button>
      )}
    />,
  );
  return { user, trigger: screen.getByRole("button", { name: "Actions" }) };
}

const items = (onSelect = () => {}): MenuItem[] => [
  { id: "a", label: "Apple", onSelect },
  { id: "b", label: "Banana", onSelect },
  { id: "c", label: "Blueberry", onSelect },
  { id: "d", label: "Cherry", onSelect },
];

describe("Menu", () => {
  it("opens with the arrow key and focuses the first item", async () => {
    const { user, trigger } = setup(items());
    trigger.focus();
    await user.keyboard("{ArrowDown}");
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("menuitem", { name: "Apple" })).toHaveFocus();
  });

  it("moves with the arrows, wraps, and jumps with Home and End", async () => {
    const { user, trigger } = setup(items());
    await user.click(trigger);
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "Banana" })).toHaveFocus();
    await user.keyboard("{End}");
    expect(screen.getByRole("menuitem", { name: "Cherry" })).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "Apple" })).toHaveFocus();
    await user.keyboard("{ArrowUp}");
    expect(screen.getByRole("menuitem", { name: "Cherry" })).toHaveFocus();
    await user.keyboard("{Home}");
    expect(screen.getByRole("menuitem", { name: "Apple" })).toHaveFocus();
  });

  it("jumps to the next label that starts with the typed letter", async () => {
    const { user, trigger } = setup(items());
    await user.click(trigger);
    await user.keyboard("b");
    expect(screen.getByRole("menuitem", { name: "Banana" })).toHaveFocus();
    await user.keyboard("b");
    expect(screen.getByRole("menuitem", { name: "Blueberry" })).toHaveFocus();
    await user.keyboard("c");
    expect(screen.getByRole("menuitem", { name: "Cherry" })).toHaveFocus();
  });

  it("skips a disabled item", async () => {
    const { user, trigger } = setup([
      { id: "a", label: "Apple", onSelect: () => {} },
      { id: "b", label: "Banana", disabled: true, onSelect: () => {} },
      { id: "c", label: "Cherry", onSelect: () => {} },
    ]);
    await user.click(trigger);
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "Cherry" })).toHaveFocus();
  });

  it("closes on Escape and returns focus to the trigger", async () => {
    const { user, trigger } = setup(items());
    await user.click(trigger);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it("runs the chosen item, closes, and returns focus", async () => {
    const onSelect = vi.fn();
    const { user, trigger } = setup(items(onSelect));
    await user.click(trigger);
    await user.keyboard("{ArrowDown}{Enter}");
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it("opens on the checked item when items choose one of several", async () => {
    const { user, trigger } = setup([
      { id: "a", label: "Jordan", selected: false, onSelect: () => {} },
      { id: "b", label: "Sam", selected: true, onSelect: () => {} },
    ]);
    await user.click(trigger);
    expect(screen.getByRole("menuitemradio", { name: "Sam" })).toHaveFocus();
  });
});
