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

  it("recognises every current and saved Claude model as a vision model", () => {
    for (const id of [
      "claude-opus-5-5",
      "claude-sonnet-5-5",
      "claude-haiku-5-5",
      "claude-fable-5-1",
      "claude-opus-5",
      "claude-sonnet-5",
      "claude-fable-5",
      "claude-haiku-4-5",
      "claude-3-5-haiku-20241022",
      "anthropic/claude-opus-5.5",
    ]) {
      expect(modelSupportsVision("anthropic", id), `${id} accepts images`).toBe(true);
    }
  });

  it("recognises the current GPT-6 and Grok 4 models without metadata", () => {
    for (const id of ["gpt-6.1-sol", "gpt-6-luna", "gpt-6-astra", "openai/gpt-6-luna"]) {
      expect(modelSupportsVision("openai", id), `${id} accepts images`).toBe(true);
    }
    for (const id of ["grok-4.7", "grok-4.3"]) {
      expect(modelSupportsVision("xai", id), `${id} accepts images`).toBe(true);
    }
    expect(modelSupportsVision("groq", "openai/gpt-oss-120b")).toBe(false);
  });

  it("trusts catalog metadata that lists image input for ids no pattern knows", () => {
    expect(modelSupportsVision("mistral", "mistral-large-latest")).toBe(false);
    expect(modelSupportsVision("mistral", "mistral-large-latest", ["text", "image"])).toBe(true);
    expect(modelSupportsVision("deepseek", "deepseek-v4-pro", ["text"])).toBe(false);
    expect(modelSupportsVision("anthropic", "claude-opus-5-5", [])).toBe(true);
  });

  it("knows DeepSeek Flash reads images without metadata and V4 Pro does not", () => {
    for (const id of ["deepseek-flash", "deepseek-v4-flash", "deepseek-v4-flash-vision-exp"]) {
      expect(modelSupportsVision("deepseek", id), `${id} accepts images`).toBe(true);
    }
    expect(modelSupportsVision("deepseek", "deepseek-v4-pro")).toBe(false);
    expect(modelSupportsVision("openrouter", "deepseek/deepseek-flash")).toBe(false);
  });

  it("does not claim vision for Claude 2 or Instant", () => {
    expect(modelSupportsVision("anthropic", "claude-2.1")).toBe(false);
    expect(modelSupportsVision("anthropic", "claude-instant-1.2")).toBe(false);
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

  it("finds a Qwen vision id among separators and trailing whitespace", () => {
    expect(modelSupportsVision("ollama", " qwen2.5vl:7b ")).toBe(true);
    expect(modelSupportsVision("ollama", " qwen2.5:7b ")).toBe(false);
  });
});
