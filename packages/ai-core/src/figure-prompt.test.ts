import { describe, expect, it } from "vitest";
import { modelSupportsVision } from "./figure-prompt";

describe("vision capability", () => {
  it("recognises GLM's vision line", () => {
    for (const id of ["glm-4v", "glm-4.1v", "glm-4.5v", "glm-4v-flash"]) {
      expect(modelSupportsVision("zai", id), `${id} is a vision model`).toBe(true);
    }
  });

  it("does not claim vision for GLM's text-only chat models", () => {
    for (const id of ["glm-5.2", "glm-4.6", "glm-5.1", "glm-4.5-air", "glm-5-turbo"]) {
      expect(modelSupportsVision("zai", id), `${id} is text only`).toBe(false);
    }
  });

  it("still recognises the other vendors' vision models", () => {
    expect(modelSupportsVision("openai", "gpt-4o")).toBe(true);
    expect(modelSupportsVision("google", "gemini-3.5-flash")).toBe(true);
    expect(modelSupportsVision("anthropic", "claude-sonnet-4-20250514")).toBe(true);
    expect(modelSupportsVision("openrouter", "qwen/qwen2-vl-7b")).toBe(true);
  });

  it("recognises common local Ollama vision model ids", () => {
    for (const id of ["qwen2.5vl:7b", "qwen3-vl:8b", "gemma3:12b"]) {
      expect(modelSupportsVision("ollama", id), `${id} is a vision model`).toBe(true);
    }
  });

  it("checks long uncontrolled model ids in bounded linear work", () => {
    expect(modelSupportsVision("ollama", "qwen".repeat(100_000))).toBe(false);
    expect(modelSupportsVision("openrouter", `${"qwen".repeat(100_000)}/qwen3-vl:8b`)).toBe(
      true,
    );
  });

  it("stays false for models with no image support", () => {
    expect(modelSupportsVision("deepseek", "deepseek-chat")).toBe(false);
    expect(modelSupportsVision("groq", "llama-3.3-70b-versatile")).toBe(false);
    expect(modelSupportsVision("ollama", "qwen2.5:7b")).toBe(false);
    expect(modelSupportsVision("ollama", "gemma3:1b")).toBe(false);
  });
});
