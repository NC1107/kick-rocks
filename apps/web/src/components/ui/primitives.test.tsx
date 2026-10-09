import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import {
  Button,
  Callout,
  EmptyState,
  Kbd,
  Menu,
  Meter,
  Row,
  RowGroup,
  Section,
  StatusMark,
  Table,
  TableBody,
  TableCell,
  TableRow,
  Tag,
  TaskStatusMark,
  Tooltip,
} from "./index.js";

describe("StatusMark", () => {
  it("draws a shape and prints the word", () => {
    const { container } = render(<StatusMark status="needs_verification" />);
    expect(screen.getByText("Needs verification")).toBeVisible();
    expect(container.querySelector("svg path")).not.toBeNull();
  });

  it("turns the ring only for a running task", () => {
    const { container } = render(<TaskStatusMark status="leased" />);
    expect(container.querySelector(".animate-running")).not.toBeNull();
    const still = render(<TaskStatusMark status="queued" />);
    expect(still.container.querySelector(".animate-running")).toBeNull();
  });
});

describe("Tooltip", () => {
  it("shows its text on keyboard focus at once and hides on blur", async () => {
    const user = userEvent.setup();
    render(
      <Tooltip content="Sent to the company">
        <button type="button">Sent</button>
      </Tooltip>,
    );
    expect(screen.queryByRole("tooltip")).toBeNull();
    await user.tab();
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Sent to the company");
    expect(screen.getByRole("button", { name: "Sent" }).parentElement).toHaveAttribute(
      "aria-describedby",
    );
    await user.tab();
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("closes on Escape", async () => {
    const user = userEvent.setup();
    render(
      <Tooltip content="Hint">
        <button type="button">Target</button>
      </Tooltip>,
    );
    await user.tab();
    expect(await screen.findByRole("tooltip")).toBeVisible();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  const tap = (target: Element) => {
    fireEvent.pointerDown(target, { pointerType: "touch" });
    fireEvent.click(target);
  };

  it("opens on a touch tap of a status mark, closes on a second tap and on a tap elsewhere", async () => {
    render(
      <>
        <Tooltip content="Cooling down 3 sites">
          <span>Mark</span>
        </Tooltip>
        <p>Elsewhere</p>
      </>,
    );
    const mark = screen.getByText("Mark");
    tap(mark);
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Cooling down 3 sites");
    tap(mark);
    expect(screen.queryByRole("tooltip")).toBeNull();
    tap(mark);
    expect(await screen.findByRole("tooltip")).toBeVisible();
    fireEvent.pointerDown(screen.getByText("Elsewhere"), { pointerType: "touch" });
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("opens on a tap of a button that only stands for a status when hintOnTap is set", async () => {
    render(
      <Tooltip content="Needs a look" hintOnTap>
        <button type="button">Status</button>
      </Tooltip>,
    );
    tap(screen.getByRole("button", { name: "Status" }));
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Needs a look");
  });

  it("never opens on a tap of a button, nor from the focus and mouse events a tap replays", async () => {
    render(
      <Tooltip content="More actions">
        <button type="button">Open</button>
      </Tooltip>,
    );
    const button = screen.getByRole("button", { name: "Open" });
    fireEvent.pointerDown(button, { pointerType: "touch" });
    fireEvent.focus(button);
    fireEvent.mouseEnter(button.parentElement as Element);
    fireEvent.click(button);
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("does not show for focus a tap or a closing overlay hands back", async () => {
    render(
      <Tooltip content="More actions">
        <button type="button">Open</button>
      </Tooltip>,
    );
    const button = screen.getByRole("button", { name: "Open" });
    await new Promise((resolve) => setTimeout(resolve, 700));
    button.focus();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(button).toHaveFocus();
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("stays hidden while the trigger's menu is open, even on a re-hover", async () => {
    const user = userEvent.setup();
    render(
      <Menu
        items={[{ id: "a", label: "Mark as confirmed", onSelect: () => {} }]}
        trigger={(props) => (
          <Tooltip content="More actions" delayMs={10}>
            <button type="button" {...props}>
              More
            </button>
          </Tooltip>
        )}
      />,
    );
    const button = screen.getByRole("button", { name: "More" });
    const wrapper = button.parentElement as Element;
    await user.click(button);
    expect(await screen.findByRole("menu")).toBeVisible();
    fireEvent.mouseLeave(wrapper);
    fireEvent.mouseEnter(wrapper);
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("closes when a menu opens", async () => {
    const user = userEvent.setup();
    render(
      <Menu
        items={[{ id: "a", label: "Mark as confirmed", onSelect: () => {} }]}
        trigger={(props) => (
          <Tooltip content="More actions">
            <button type="button" {...props}>
              More
            </button>
          </Tooltip>
        )}
      />,
    );
    await user.tab();
    expect(await screen.findByRole("tooltip")).toBeVisible();
    await user.keyboard("{ArrowDown}");
    expect(await screen.findByRole("menu")).toBeVisible();
    expect(screen.queryByRole("tooltip")).toBeNull();
  });
});

describe("Meter", () => {
  it("reports its value and turns to attention past the warning line", () => {
    const { rerender, container } = render(
      <Meter label="Sent today" value={42} max={150} readout="42 of 150" />,
    );
    const meter = screen.getByRole("meter", { name: "Sent today" });
    expect(meter).toHaveAttribute("aria-valuenow", "42");
    expect(container.querySelector(".bg-accent-fill")).not.toBeNull();
    rerender(<Meter label="Sent today" value={130} max={150} readout="130 of 150" />);
    expect(container.querySelector(".bg-attention")).not.toBeNull();
    expect(container.querySelector(".bg-accent-fill")).toBeNull();
  });

  it("clamps a value outside the range", () => {
    const { container } = render(<Meter label="Quota" value={500} max={150} />);
    expect(container.querySelector<HTMLElement>(".h-full")?.style.width).toBe("100%");
  });
});

describe("Section and RowGroup", () => {
  it("folds the count into the label and renders the rows", () => {
    render(
      <MemoryRouter>
        <Section label="Needs you" count={3}>
          <RowGroup>
            <Row title="ClearCheck" description="Asked for ID" to="/review" />
            <Row title="AudienceGrid" onClick={() => undefined} selected />
            <Row title="Static" />
          </RowGroup>
        </Section>
      </MemoryRouter>,
    );
    expect(screen.getByRole("heading", { name: /Needs you/ })).toHaveTextContent("3");
    expect(screen.getByRole("link", { name: /ClearCheck/ })).toHaveAttribute("href", "/review");
    expect(screen.getByRole("button", { name: /AudienceGrid/ })).toHaveAttribute(
      "data-selected",
      "true",
    );
    expect(screen.getByText("Static").closest("button")).toBeNull();
  });
});

describe("Table", () => {
  it("marks the selected row and keeps the frame named", () => {
    render(
      <Table label="Targets">
        <TableBody>
          <TableRow selected>
            <TableCell mono>KR-1</TableCell>
          </TableRow>
          <TableRow>
            <TableCell>Other</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    );
    const rows = within(screen.getByRole("region", { name: "Targets" })).getAllByRole("row");
    expect(rows[0]).toHaveAttribute("data-selected", "true");
    expect(rows[1]).not.toHaveAttribute("data-selected");
  });
});

describe("Button", () => {
  it("keeps a loading button looking like its variant and blocks clicks", () => {
    render(
      <Button variant="primary" loading>
        Sending
      </Button>,
    );
    const button = screen.getByRole("button", { name: /Sending/ });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
  });
});

describe("small primitives", () => {
  it("prints a tag, a keycap, a callout, and an empty state as plain text", () => {
    render(
      <>
        <Tag tone="attention">CAPTCHA</Tag>
        <Kbd>K</Kbd>
        <Callout intent="danger" title="Could not load">
          Could not reach the server.
        </Callout>
        <EmptyState title="Nothing needs you." />
      </>,
    );
    expect(screen.getByText("CAPTCHA")).toBeVisible();
    expect(screen.getByText("K").tagName).toBe("KBD");
    expect(screen.getByRole("alert")).toHaveTextContent("Could not reach the server.");
    expect(screen.getByText("Nothing needs you.")).toBeVisible();
  });
});
