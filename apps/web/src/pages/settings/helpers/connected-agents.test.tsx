import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { applyAgentPreset } from "../../../../mock/agents.js";
import { createMockApp } from "../../../../mock/app.js";
import { renderPage } from "../../../test/render.js";
import { Component as SetupPage } from "../index.js";

const setup = (mock = createMockApp()) =>
  renderPage(<SetupPage />, { path: "/settings", route: "/settings", mock });

const section = async () =>
  within(
    (await screen.findByRole("heading", { name: /^Connected agents/ })).closest(
      "section",
    ) as HTMLElement,
  );

describe("the connected agents", () => {
  it("says none are connected, in one muted line", async () => {
    setup();
    expect(await screen.findByText("None connected")).toBeVisible();
  });

  it("lists each agent worker and MCP client with how it stands and what it does about sending", async () => {
    const mock = createMockApp();
    applyAgentPreset(mock.store, "several");
    setup(mock);
    const connected = await section();
    expect(await connected.findByText("nick-pc-agent")).toBeVisible();
    expect(connected.getByText("laptop-agent")).toBeVisible();
    expect(connected.getByText("desk-client")).toBeVisible();
    expect(connected.getAllByText("Online")).toHaveLength(1);
    expect(connected.getAllByText("Offline")).toHaveLength(1);
    expect(connected.getAllByText("Active")).toHaveLength(1);
    expect(connected.getAllByText("Idle")).toHaveLength(1);
    expect(
      connected.getAllByText(/Drives its own browser\. Kick Rocks cannot hold what it sends\./),
    ).toHaveLength(2);
  });

  it("asks for a worker id per MCP client", async () => {
    setup();
    await userEvent.click(await screen.findByRole("button", { name: "Set up" }));
    expect(await screen.findByText(/Give each client its own worker id/)).toBeVisible();
  });
});
