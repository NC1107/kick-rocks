import { describe, expect, it } from "vitest";
import { toolCallInText } from "./text-call.js";

const TOOLS = ["navigate", "click", "report"];

describe("toolCallInText", () => {
  it("reads a bare call", () => {
    expect(toolCallInText('{"name": "click", "arguments": {"ref": "e4"}}', TOOLS, "t1")).toEqual({
      id: "t1",
      name: "click",
      args: { ref: "e4" },
    });
  });

  it("reads a call inside tool_call tags, with words around it", () => {
    const text =
      'Checking now.\n<tool_call>\n{"name":"navigate","arguments":{"url":"https://a.test/"}}\n</tool_call>';
    expect(toolCallInText(text, TOOLS, "t2")).toMatchObject({
      name: "navigate",
      args: { url: "https://a.test/" },
    });
  });

  it("reads a call in a code fence, and a nested object in its arguments", () => {
    const text =
      '```json\n{"name": "report", "arguments": {"status": "complete", "result": {"purpose": "scan", "scan": {"candidates": []}}}}\n```';
    expect(toolCallInText(text, TOOLS, "t3")).toMatchObject({
      name: "report",
      args: { status: "complete", result: { purpose: "scan" } },
    });
  });

  it("is not thrown by braces inside strings or by placeholders in the prose", () => {
    const text =
      'I will type {{first_name}} then {"name": "click", "arguments": {"ref": "e1", "note": "a } b"}}';
    expect(toolCallInText(text, TOOLS, "t4")).toMatchObject({ name: "click" });
  });

  it("leaves a text with two objects alone", () => {
    const text =
      '{"name": "click", "arguments": {"ref": "e1"}} {"name": "click", "arguments": {"ref": "e2"}}';
    expect(toolCallInText(text, TOOLS, "t5")).toBeNull();
  });

  it("reads a bare object with a final status and no name as a report call", () => {
    for (const status of ["complete", "blocked", "failed", "release"]) {
      const text = JSON.stringify({ status, records: [] });
      expect(toolCallInText(text, TOOLS, "t7")).toEqual({
        id: "t7",
        name: "report",
        args: { status, records: [] },
      });
    }
    expect(
      toolCallInText('Done.\n{"status":"complete","records":["/profile/a"]}', TOOLS, "t8"),
    ).toMatchObject({ name: "report", args: { records: ["/profile/a"] } });
  });

  it("reads an object whose only key is url as a navigate call", () => {
    expect(toolCallInText('{"url": "/profile/abc"}', TOOLS, "t9")).toEqual({
      id: "t9",
      name: "navigate",
      args: { url: "/profile/abc" },
    });
  });

  it("does not read a bare object as a call when it could be something else", () => {
    expect(toolCallInText('{"status": "pending"}', TOOLS, "t10")).toBeNull();
    expect(toolCallInText('{"url": "/a", "extra": 1}', TOOLS, "t10")).toBeNull();
    expect(toolCallInText('{"status": "complete"}', ["navigate"], "t10")).toBeNull();
    expect(toolCallInText('{"url": "/a"}', ["report"], "t10")).toBeNull();
    expect(toolCallInText('{"name": "rm", "status": "complete"}', TOOLS, "t10")).toBeNull();
  });

  it("leaves a name that is no tool of this task, and a shape that is not a call, alone", () => {
    expect(toolCallInText('{"name": "rm", "arguments": {}}', TOOLS, "t6")).toBeNull();
    expect(toolCallInText('{"name": "click"}', TOOLS, "t6")).toBeNull();
    expect(toolCallInText('{"name": "click", "arguments": "e1"}', TOOLS, "t6")).toBeNull();
    expect(toolCallInText('{"name": "click", "arguments": ["e1"]}', TOOLS, "t6")).toBeNull();
    expect(toolCallInText("I am done, nothing more to do.", TOOLS, "t6")).toBeNull();
    expect(toolCallInText('{"name": "click", "arguments": {"ref": ', TOOLS, "t6")).toBeNull();
  });
});
