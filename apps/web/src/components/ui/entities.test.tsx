import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MailCheck } from "lucide-react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { describe, expect, it } from "vitest";
import { paths, taskPath } from "../../lib/paths.js";
import {
  BreakableAddress,
  Count,
  CountLink,
  EntityLink,
  EntityRow,
  FactList,
  IconAction,
  PageBack,
  ToastProvider,
  useToast,
} from "./index.js";

const TASK = { id: "tsk_9", kind: "email_send", requestId: "req_1" } as const;

function Where() {
  const { pathname, search } = useLocation();
  return <p data-testid="where">{`${pathname}${search}`}</p>;
}

describe("paths", () => {
  it("builds each address from one place", () => {
    expect(paths.profile("p 1")).toBe("/profiles/p%201");
    expect(paths.mailbox("p1")).toBe("/profiles/p1/mailbox");
    expect(paths.requests({ status: "awaiting_reply", campaignId: "cmp_1" })).toBe(
      "/requests?status=awaiting_reply&campaignId=cmp_1",
    );
    expect(paths.requests()).toBe("/requests");
    expect(paths.campaign("cmp_1")).toBe("/requests?campaignId=cmp_1");
    expect(paths.review()).toBe("/review");
    expect(paths.reviewItem("task:tsk_1")).toBe("/review?item=task%3Atsk_1");
    expect(paths.reviewSection("mail")).toBe("/review/mail");
    expect(paths.reviewSection("problems", "failed:tsk_1")).toBe(
      "/review/problems?item=failed%3Atsk_1",
    );
    expect(paths.settings("recipes")).toBe("/settings/recipes");
    expect(paths.settings("schedule")).toBe("/settings/advanced#schedule");
  });

  it("opens a task in the Review item that matches it, else in its request", () => {
    expect(taskPath({ ...TASK, status: "blocked" })).toBe("/review?item=task%3Atsk_9");
    expect(taskPath({ ...TASK, status: "failed" })).toBe("/review/problems?item=failed%3Atsk_9");
    expect(taskPath({ ...TASK, kind: "agent", status: "queued" })).toBe(
      "/review/agents?item=agent%3Atsk_9",
    );
    expect(
      taskPath({
        ...TASK,
        kind: "agent",
        status: "queued",
        assignment: {
          to: { kind: "person" },
          at: "2026-10-01T00:00:00.000Z",
          by: "user",
          fallback: "any",
        },
      }),
    ).toBe("/review?item=task%3Atsk_9");
    expect(taskPath({ ...TASK, status: "done" })).toBe("/requests/req_1");
    expect(taskPath({ ...TASK, status: "done", requestId: null })).toBeNull();
    expect(paths.task({ ...TASK, status: "done", requestId: null })).toBe("/review");
  });
});

describe("EntityLink", () => {
  it("links a request by its reference in mono and leaves a way back", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/targets/t1"]}>
        <Routes>
          <Route
            path="/targets/:id"
            element={
              <EntityLink
                to={{ kind: "request", id: "req_1", reference: "KR-ABC123", targetName: "Panera" }}
                show="ref"
              />
            }
          />
          <Route
            path="/requests/:id"
            element={
              <>
                <Where />
                <PageBack />
              </>
            }
          />
        </Routes>
      </MemoryRouter>,
    );
    const link = screen.getByRole("link", { name: "KR-ABC123" });
    expect(link).toHaveClass("font-mono");
    await user.click(link);
    expect(screen.getByTestId("where")).toHaveTextContent("/requests/req_1");
    expect(screen.getByRole("link", { name: /Site/ })).toHaveAttribute("href", "/targets/t1");
  });

  it("falls back to plain text when the id is missing", () => {
    render(
      <MemoryRouter>
        <EntityLink to={{ kind: "target", id: "", name: "Nowhere" }} />
      </MemoryRouter>,
    );
    expect(screen.getByText("Nowhere")).toBeVisible();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("shows a mailbox address in mono and a task by its kind", () => {
    render(
      <MemoryRouter>
        <EntityLink to={{ kind: "mailbox", profileId: "p1", address: "a@b.example" }} />
        <EntityLink to={{ kind: "task", task: { ...TASK, status: "blocked" } }} variant="quiet" />
      </MemoryRouter>,
    );
    expect(screen.getByRole("link", { name: "a@b.example" })).toHaveClass("font-mono");
    expect(screen.getByRole("link", { name: "Send email" })).toHaveAttribute(
      "href",
      "/review?item=task%3Atsk_9",
    );
  });
});

describe("IconAction", () => {
  it("names itself for assistive tech and runs its action", async () => {
    const user = userEvent.setup();
    let ran = 0;
    render(
      <MemoryRouter>
        <IconAction label="Check for replies" icon={MailCheck} badge="23s" onClick={() => ran++} />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole("button", { name: "Check for replies" }));
    expect(ran).toBe(1);
    expect(screen.getByText("23s")).toBeInTheDocument();
  });

  it("is a link when given a destination", () => {
    render(
      <MemoryRouter>
        <IconAction label="Open mailbox" icon={MailCheck} to="/profiles/p1/mailbox" />
      </MemoryRouter>,
    );
    expect(screen.getByRole("link", { name: "Open mailbox" })).toHaveAttribute(
      "href",
      "/profiles/p1/mailbox",
    );
  });

  it("shows its text label only from the chosen width", () => {
    render(
      <MemoryRouter>
        <IconAction label="Add name" icon={MailCheck} labelFrom="sm" />
      </MemoryRouter>,
    );
    expect(screen.getByText("Add name")).toHaveClass("hidden", "sm:inline");
  });
});

describe("FactList and counts", () => {
  it("prints each term with its value and keeps terms beside values from 360px", () => {
    const { container } = render(
      <FactList
        items={[
          { term: "Channel", value: "Email" },
          { term: "Reference", value: "KR-1", mono: true },
        ]}
      />,
    );
    expect(screen.getByText("Channel")).toBeInTheDocument();
    expect(screen.getByText("KR-1")).toHaveClass("font-mono");
    expect(container.querySelector("dl > div")?.className).toContain("min-[360px]:grid-cols");
  });

  it("reads a count with its label and links it to its list", () => {
    render(
      <MemoryRouter>
        <Count value={3} label="events" />
        <CountLink value={2} to={{ kind: "campaign", id: "cmp_1" }} label="Requests" />
      </MemoryRouter>,
    );
    expect(screen.getByText("events")).toHaveClass("sr-only");
    expect(screen.getByRole("link", { name: "Requests 2" })).toHaveAttribute(
      "href",
      "/requests?campaignId=cmp_1",
    );
  });
});

describe("EntityRow", () => {
  it("makes the name a link with a stretched tap target", () => {
    render(
      <MemoryRouter>
        <EntityRow
          to={{ kind: "target", id: "t1", name: "Panera" }}
          title="Panera"
          meta="KR-1"
          trailing={<button type="button">Act</button>}
        />
      </MemoryRouter>,
    );
    const link = screen.getByRole("link", { name: "Panera" });
    expect(link).toHaveAttribute("href", "/targets/t1");
    expect(link.className).toContain("after:absolute");
    expect(screen.getByRole("button", { name: "Act" })).toBeVisible();
  });

  it("selects instead of navigating in button mode", async () => {
    const user = userEvent.setup();
    let picked = 0;
    render(
      <MemoryRouter>
        <EntityRow
          to={{ kind: "target", id: "t1", name: "Panera" }}
          title="Panera"
          onSelect={() => picked++}
        />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole("button", { name: "Panera" }));
    expect(picked).toBe(1);
    expect(screen.queryByRole("link")).toBeNull();
  });
});

describe("Toast action", () => {
  function Fire() {
    const toast = useToast();
    return (
      <button
        type="button"
        onClick={() =>
          toast.success("Created Jo", undefined, {
            action: { kind: "profile", id: "p1", name: "Jo" },
          })
        }
      >
        fire
      </button>
    );
  }

  it("links the toast to the thing it names", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <ToastProvider>
          <Fire />
        </ToastProvider>
      </MemoryRouter>,
    );
    await user.click(screen.getByRole("button", { name: "fire" }));
    expect(screen.getByRole("link", { name: "Jo" })).toHaveAttribute("href", "/profiles/p1");
  });
});

describe("PageBack", () => {
  it("falls back to the parent in the header trail", () => {
    render(
      <MemoryRouter initialEntries={["/requests/req_1"]}>
        <PageBack />
      </MemoryRouter>,
    );
    expect(screen.getByRole("link", { name: /Removals/ })).toHaveAttribute("href", "/requests");
  });

  it("renders nothing on a page with no parent", () => {
    render(
      <MemoryRouter initialEntries={["/review"]}>
        <PageBack />
      </MemoryRouter>,
    );
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("uses the frame's fallback when there is no trail parent", () => {
    render(
      <MemoryRouter initialEntries={["/review"]}>
        <PageBack fallback={{ to: "/", label: "Dashboard" }} />
      </MemoryRouter>,
    );
    expect(screen.getByRole("link", { name: /Dashboard/ })).toHaveAttribute("href", "/");
  });
});

describe("BreakableAddress", () => {
  it("offers a break after the @ and each dot, and keeps the text whole", () => {
    const { container } = render(<BreakableAddress text="privacy@maplewood.example" />);
    expect(container.textContent).toBe("privacy@maplewood.example");
    expect(container.querySelectorAll("wbr")).toHaveLength(2);
  });
});
