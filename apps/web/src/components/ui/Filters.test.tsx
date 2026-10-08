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
    render(
      <>
        <Filters groups={[group()]} onClear={vi.fn()} />
        <button type="button">Next</button>
      </>,
    );
    await user.click(screen.getByRole("button", { name: "Filters" }));
    await user.tab();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next" })).toHaveFocus();
  });

  it("opens as a modal sheet on a phone", async () => {
    const user = userEvent.setup();
    setPhone(true);
    const showModal = vi.spyOn(HTMLDialogElement.prototype, "showModal");
    render(<Filters groups={[group("company")]} onClear={vi.fn()} resultCount="5 targets" />);
    await user.click(screen.getByRole("button", { name: "Filters, 1 active" }));
    expect(showModal).toHaveBeenCalledOnce();
    expect(screen.getByLabelText("Type")).toHaveFocus();
    showModal.mockRestore();
  });

  it("closes on Escape after focus left the panel", async () => {
    const user = userEvent.setup();
    setPhone(false);
    render(<Filters groups={[group("company")]} onClear={vi.fn()} />);
    const button = screen.getByRole("button", { name: "Filters, 1 active" });
    await user.click(button);
    await user.click(screen.getByRole("heading", { name: "Filters" }));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(button).toHaveFocus();
  });

  it("returns focus to the button on Shift+Tab from the first control", async () => {
    const user = userEvent.setup();
    setPhone(false);
    render(<Filters groups={[group()]} onClear={vi.fn()} />);
    const button = screen.getByRole("button", { name: "Filters" });
    await user.click(button);
    await user.tab({ shift: true });
    expect(screen.getByRole("button", { name: "Close filters" })).toHaveFocus();
    await user.tab({ shift: true });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(button).toHaveFocus();
  });

  it("hides Clear all when no filter is active", async () => {
    const user = userEvent.setup();
    render(<Filters groups={[group()]} onClear={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Filters" }));
    expect(screen.queryByRole("button", { name: "Clear all" })).not.toBeInTheDocument();
  });

  it("keeps focus in the panel after Clear all", async () => {
    const user = userEvent.setup();
    render(<Filters groups={[group("company")]} onClear={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Filters, 1 active" }));
    await user.click(screen.getByRole("button", { name: "Clear all" }));
    expect(screen.getByLabelText("Type")).toHaveFocus();
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

  it("moves focus to the next tag, else the previous, when one is removed", async () => {
    const user = userEvent.setup();
    const tags = [
      { id: "a", label: "A: one", onRemove: vi.fn() },
      { id: "b", label: "B: two", onRemove: vi.fn() },
    ];
    render(<FilterTags tags={tags} />);
    await user.click(screen.getByRole("button", { name: "Remove A: one" }));
    expect(screen.getByRole("button", { name: "Remove B: two" })).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Remove B: two" }));
    expect(screen.getByRole("button", { name: "Remove A: one" })).toHaveFocus();
  });

  it("moves focus to the fallback when the last tag is removed", async () => {
    const user = userEvent.setup();
    const fallback = { current: document.createElement("button") };
    document.body.append(fallback.current);
    render(
      <FilterTags
        tags={[{ id: "a", label: "A: one", onRemove: vi.fn() }]}
        emptyFocusRef={fallback}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Remove A: one" }));
    expect(fallback.current).toHaveFocus();
    fallback.current.remove();
  });
});
