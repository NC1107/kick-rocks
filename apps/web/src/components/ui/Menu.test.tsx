import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Menu, type MenuItem, type MenuTriggerProps } from "./Menu.js";

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

describe("Menu placement", () => {
  const rectOf = (rect: Partial<DOMRect>) => ({
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: 0,
    height: 0,
    toJSON: () => ({}),
    ...rect,
  });

  const trigger = (props: MenuTriggerProps) => (
    <button type="button" {...props}>
      Actions
    </button>
  );

  it("is not clipped by a box that hides overflow around its trigger", async () => {
    const user = userEvent.setup();
    render(
      <div data-testid="clip" className="overflow-hidden">
        <Menu items={items()} trigger={trigger} />
      </div>,
    );
    await user.click(screen.getByRole("button", { name: "Actions" }));
    expect(screen.getByTestId("clip")).not.toContainElement(screen.getByRole("menu"));
  });

  it("keeps every item on the screen, above the trigger when there is no room below", async () => {
    const user = userEvent.setup();
    const spy = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: HTMLElement) {
        if (this.getAttribute("role") === "menu") return rectOf({ width: 200, height: 240 });
        return rectOf({ top: 700, bottom: 730, left: 300, right: 360, width: 60, height: 30 });
      });
    try {
      render(<Menu items={items()} trigger={trigger} />);
      await user.click(screen.getByRole("button", { name: "Actions" }));
      const menu = screen.getByRole("menu");
      const top = Number.parseFloat(menu.style.top);
      expect(top).toBeGreaterThanOrEqual(0);
      expect(top + 240).toBeLessThanOrEqual(window.innerHeight);
      expect(Number.parseFloat(menu.style.left) + 200).toBeLessThanOrEqual(window.innerWidth);
    } finally {
      spy.mockRestore();
    }
  });
});
