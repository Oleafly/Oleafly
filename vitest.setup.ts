import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

vi.mock("@lobehub/icons", () => {
  const stub = () => {
    const Icon = () => null;
    Icon.Color = () => null;
    Icon.Avatar = () => null;
    Icon.Text = () => null;
    Icon.Combine = () => null;
    return Icon;
  };
  return {
    OpenAI: stub(),
    Anthropic: stub(),
    Gemini: stub(),
    Groq: stub(),
    OpenRouter: stub(),
    DeepSeek: stub(),
    Mistral: stub(),
    Grok: stub(),
    Ollama: stub(),
    Perplexity: stub(),
    ZAI: stub(),
  };
});

afterEach(cleanup);

if (typeof localStorage === "undefined") {
  const lsValues = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => lsValues.get(key) ?? null,
    setItem: (key: string, value: string) => lsValues.set(key, value),
    removeItem: (key: string) => lsValues.delete(key),
    clear: () => lsValues.clear(),
    key: (index: number) => Array.from(lsValues.keys())[index] ?? null,
    get length() {
      return lsValues.size;
    },
  } as Storage);
}
