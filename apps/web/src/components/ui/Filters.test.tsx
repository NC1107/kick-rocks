import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type FilterGroup, Filters, FilterTags } from "./Filters.js";

function group(value = "", onChange = vi.fn()): FilterGroup {
  return {
    id: "kind",
    label: "Type",
    value,
    allLabel: "All types",
    options: [
      { value: "company", label: "Company", count: 3 },
      { value: "broker", label: "Broker", count: 2 },
    ],
    onChange,
  };
}

function setPhone(matches: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
}

afterEach(() => vi.unstubAllGlobals());

describe("Filters", () => {
  it("opens from the button, which reports it", async () => {
    const user = userEvent.setup();
    render(<Filters groups={[group()]} onClear={vi.fn()} />);
    const button = screen.getByRole("button", { name: "Filters" });
    expect(button).toHaveAttribute("aria-expanded", "false");
    await user.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(button.getAttribute("aria-controls")).toBe(screen.getByRole("dialog").id);
    expect(screen.getByLabelText("Type")).toHaveFocus();
  });

  it("reports a change at once", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Filters groups={[group("", onChange)]} onClear={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Filters" }));
    await user.selectOptions(screen.getByLabelText("Type"), "broker");
    expect(onChange).toHaveBeenCalledWith("broker");
  });

  it("shows the active count and clears all", async () => {
    const user = userEvent.setup();
    const onClear = vi.fn();
    render(<Filters groups={[group("company")]} onClear={onClear} />);
    await user.click(screen.getByRole("button", { name: "Filters, 1 active" }));
    await user.click(screen.getByRole("button", { name: "Clear all" }));
    expect(onClear).toHaveBeenCalledOnce();
  });

  it("closes on Escape and gives focus back to the button", async () => {
    const user = userEvent.setup();
    render(<Filters groups={[group()]} onClear={vi.fn()} />);
    const button = screen.getByRole("button", { name: "Filters" });
    await user.click(button);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(button).toHaveFocus();
  });

  it("closes from the close button", async () => {
    const user = userEvent.setup();
    render(<Filters groups={[group()]} onClear={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Filters" }));
    await user.click(screen.getByRole("button", { name: "Close filters" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("closes when focus tabs out of the popover on wider screens", async () => {
    const user = userEvent.setup();
    setPhone(false);
    render(<Filters groups={[group()]} onClear={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Filters" }));
    await user.tab();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("keeps focus inside the sheet on a phone", async () => {
    const user = userEvent.setup();
    setPhone(true);
    render(<Filters groups={[group("company")]} onClear={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Filters, 1 active" }));
    const dialog = screen.getByRole("dialog");
    expect(screen.getByLabelText("Type")).toHaveFocus();
    for (let step = 0; step < 6; step++) {
      await user.tab();
      expect(dialog).toContainElement(document.activeElement as HTMLElement);
    }
    for (let step = 0; step < 6; step++) {
      await user.tab({ shift: true });
      expect(dialog).toContainElement(document.activeElement as HTMLElement);
    }
  });
});

describe("FilterTags", () => {
  it("renders nothing without tags", () => {
    const { container } = render(<FilterTags tags={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("removes a tag from its x", async () => {
    const user = userEvent.setup();
    const onRemove = vi.fn();
    render(<FilterTags tags={[{ id: "kind", label: "Type: Company", onRemove }]} />);
    await user.click(screen.getByRole("button", { name: "Remove Type: Company" }));
    expect(onRemove).toHaveBeenCalledOnce();
  });
});
