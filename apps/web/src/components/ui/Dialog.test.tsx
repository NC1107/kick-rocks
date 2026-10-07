import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { ConfirmDialog, Dialog } from "./Dialog.js";

function Harness({ dismissible = true }: { dismissible?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Rename" dismissible={dismissible}>
        <input aria-label="Name" />
      </Dialog>
    </>
  );
}

describe("Dialog", () => {
  it("moves focus to the first field when it opens", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(screen.getByRole("dialog", { name: "Rename" })).toBeVisible();
    expect(screen.getByLabelText("Name")).toHaveFocus();
  });

  it("closes on Escape and gives focus back to the button that opened it", async () => {
    render(<Harness />);
    const opener = screen.getByRole("button", { name: "Open" });
    await userEvent.click(opener);
    fireEvent(
      screen.getByRole("dialog", { hidden: true }),
      new Event("cancel", { cancelable: true }),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(opener).toHaveFocus();
  });

  it("closes from the close button", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: "Open" }));
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("ignores Escape and offers no close button while it must not be dismissed", async () => {
    render(<Harness dismissible={false} />);
    await userEvent.click(screen.getByRole("button", { name: "Open" }));
    fireEvent(screen.getByRole("dialog"), new Event("cancel", { cancelable: true }));
    expect(screen.getByRole("dialog")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
  });
});

describe("ConfirmDialog", () => {
  it("starts on Cancel so Enter never confirms by accident", () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open
        onClose={() => {}}
        onConfirm={onConfirm}
        title="Delete"
        confirmLabel="Delete"
      />,
    );
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
