import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { applyAgentPreset } from "../../../../mock/agents.js";
import { createMockApp } from "../../../../mock/app.js";
import { renderPage } from "../../../test/render.js";
import { Component as AgentsPage } from "./index.js";

const agents = (mock = createMockApp()) =>
  renderPage(<AgentsPage />, { path: "/settings/agents", route: "/settings/agents", mock });

const section = async () =>
  within(
    (await screen.findByRole("heading", { name: /^Connected agents/ })).closest(
      "section",
    ) as HTMLElement,
  );

describe("the connected agents", () => {
  it("says nothing has connected yet", async () => {
    agents();
    expect(await (await section()).findByText(/No agent has connected yet\./)).toBeVisible();
  });

  it("lists each agent worker and MCP client with how it stands and what it does about sending", async () => {
    const mock = createMockApp();
    applyAgentPreset(mock.store, "several");
    agents(mock);
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

  it("asks for a worker id per MCP client, because clients that share one are treated as one", async () => {
    agents();
    await userEvent.click(await screen.findByRole("button", { name: "Set up" }));
    expect(await screen.findByText(/Give each client its own worker id/)).toBeVisible();
    expect(screen.getByText(/Clients that share one id are treated as one\./)).toBeVisible();
  });
});
