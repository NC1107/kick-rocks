import { describe, expect, it } from "vitest";
import {
  agentEnvLines,
  DEFAULT_GPU_SIZE_GB,
  GPU_SIZES_GB,
  gateCommand,
  isOllamaEndpoint,
  MODEL_PRESETS,
  presetFor,
} from "./model-presets.js";

describe("the model presets", () => {
  it("has one preset for each card size, in order", () => {
    expect(MODEL_PRESETS.map((preset) => preset.gpuGb)).toEqual([...GPU_SIZES_GB]);
    expect(GPU_SIZES_GB).toContain(DEFAULT_GPU_SIZE_GB);
  });

  it("gives every size a reply model, and an agent model only where one measured well", () => {
    for (const preset of MODEL_PRESETS) {
      expect(preset.reply.model).not.toBe("");
      expect((preset.agent === null) === (preset.agentFallback !== null)).toBe(true);
    }
    expect(presetFor(6).agent).toBeNull();
    expect(presetFor(8).agent?.model).toBe("granite4.1:8b");
    expect(presetFor(12).agent?.model).toBe("qwen3:14b");
    expect(presetFor(16).agent?.model).toBe("gpt-oss:20b");
  });

  it("picks the largest preset that fits a card", () => {
    expect(presetFor(10).gpuGb).toBe(8);
    expect(presetFor(48).gpuGb).toBe(24);
    expect(presetFor(2).gpuGb).toBe(6);
  });

  it("writes the agent worker settings the guide gives, with thinking off only where it was measured off", () => {
    const qwen = presetFor(12).agent;
    const gptOss = presetFor(16).agent;
    if (!qwen || !gptOss) throw new Error("expected agent presets");
    expect(agentEnvLines(qwen)).toContain("KICKROCKS_AGENT_THINKING=off");
    expect(agentEnvLines(gptOss).join("\n")).not.toContain("THINKING");
    expect(agentEnvLines(gptOss)).toEqual(
      expect.arrayContaining([
        "KICKROCKS_AGENT_PROVIDER=ollama",
        "KICKROCKS_AGENT_MODEL=gpt-oss:20b",
        "KICKROCKS_AGENT_NUM_CTX=16384",
      ]),
    );
  });

  it("writes the gate command with the same settings the worker will run with", () => {
    const qwen = presetFor(12).agent;
    if (!qwen) throw new Error("expected an agent preset");
    expect(gateCommand(qwen, "https://kr.example.org")).toBe(
      [
        "KICKROCKS_SERVER_URL=https://kr.example.org \\",
        "pnpm --filter @kickrocks/agent-worker bench \\",
        "  --model qwen3:14b --provider ollama --num-ctx 16384 --thinking off \\",
        "  --agent-only --scenarios 1,3,5,6,7,8,9,10 --runs 5 --record",
      ].join("\n"),
    );
  });

  it("tells an ollama address from a hosted endpoint", () => {
    expect(isOllamaEndpoint("http://host.docker.internal:11434/v1")).toBe(true);
    expect(isOllamaEndpoint("http://127.0.0.1:11434/v1")).toBe(true);
    expect(isOllamaEndpoint("https://api.openai.com/v1")).toBe(false);
    expect(isOllamaEndpoint("not a url")).toBe(false);
  });
});
