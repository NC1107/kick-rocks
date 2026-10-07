import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { Tab, TabList, TabPanel, Tabs } from "./Tabs.js";

function setup() {
  render(
    <Tabs defaultValue="one">
      <TabList>
        <Tab value="one">One</Tab>
        <Tab value="two">Two</Tab>
        <Tab value="three" disabled>
          Three
        </Tab>
        <Tab value="four">Four</Tab>
      </TabList>
      <TabPanel value="one">First panel</TabPanel>
      <TabPanel value="two">Second panel</TabPanel>
      <TabPanel value="four">Fourth panel</TabPanel>
    </Tabs>,
  );
  return userEvent.setup();
}

describe("Tabs", () => {
  it("shows only the selected panel and puts only the selected tab in the Tab order", () => {
    setup();
    expect(screen.getByRole("tabpanel")).toHaveTextContent("First panel");
    expect(screen.getByRole("tab", { name: "One" })).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("tab", { name: "Two" })).toHaveAttribute("tabindex", "-1");
  });

  it("selects as the arrows move, skips a disabled tab, and wraps", async () => {
    const user = setup();
    screen.getByRole("tab", { name: "One" }).focus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Two" })).toHaveFocus();
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Second panel");
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Four" })).toHaveFocus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "One" })).toHaveFocus();
    await user.keyboard("{ArrowLeft}");
    expect(screen.getByRole("tab", { name: "Four" })).toHaveFocus();
  });

  it("jumps to the first and last tab with Home and End", async () => {
    const user = setup();
    screen.getByRole("tab", { name: "Two" }).focus();
    await user.keyboard("{End}");
    expect(screen.getByRole("tab", { name: "Four" })).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{Home}");
    expect(screen.getByRole("tab", { name: "One" })).toHaveAttribute("aria-selected", "true");
  });

  it("brings the selected tab into view, so one chosen from the address is not hidden", () => {
    const scrolled: string[] = [];
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function scrollIntoView(this: Element) {
      scrolled.push(this.textContent ?? "");
    };
    try {
      render(
        <Tabs value="four">
          <TabList>
            <Tab value="one">One</Tab>
            <Tab value="four">Four</Tab>
          </TabList>
        </Tabs>,
      );
      expect(scrolled).toEqual(["Four"]);
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });
});
