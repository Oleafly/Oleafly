// @vitest-environment jsdom

import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import enSettings from "@/i18n/locales/en/settings.json" with { type: "json" };
import type { AppConfig, StoredModel } from "@/lib/tauri";
import { useSettingsStore } from "@/store/settings";

const providerConfig = vi.hoisted(() => ({ current: null as AppConfig | null }));

vi.mock("@/components/ai/provider-config", () => ({
  knownProviderConfig: () => providerConfig.current,
  loadProviderConfig: async () => {
    if (!providerConfig.current) throw new Error("no config in tests");
    return providerConfig.current;
  },
  subscribeProviderConfig: () => () => {},
}));

import { AiCompletionModelSetting } from "./AiCompletionModelSetting";

Element.prototype.scrollIntoView = vi.fn();

const copy = enSettings.appearance.editor.aiCompletionModel;
const stored = (id: string): StoredModel => ({ id, name: id.toUpperCase(), enabled: true, source: "fetched" });

const CONFIGURED = {
  ai_provider: "openai",
  ai_model: "gpt-main",
  ai_keys: { openai: "sk-test" },
  ai_provider_models: { openai: [stored("gpt-main"), stored("gpt-fast")] },
} as unknown as AppConfig;

beforeEach(() => {
  useSettingsStore.setState({ aiCompletionProvider: "", aiCompletionModel: "" });
});

afterEach(() => {
  providerConfig.current = null;
  localStorage.clear();
});

describe("AI completion model", () => {
  it("starts on the default model and saves the model picked for completions", () => {
    providerConfig.current = CONFIGURED;
    render(<AiCompletionModelSetting />);
    const row = screen.getByTestId("settings-ai-completion-model");
    expect(within(row).getByText(copy.description)).toBeInTheDocument();
    const picker = within(row).getByRole("combobox", { name: "AI model" });
    expect(picker).toHaveTextContent("GPT-MAIN");

    fireEvent.click(picker);
    fireEvent.click(screen.getByText("GPT-FAST"));
    expect(useSettingsStore.getState()).toMatchObject({
      aiCompletionProvider: "openai",
      aiCompletionModel: "gpt-fast",
    });
    expect(localStorage.getItem("oleafly.aiCompletion.model")).toBe("gpt-fast");
    expect(within(row).getByRole("combobox", { name: "AI model" })).toHaveTextContent("GPT-FAST");
  });

  it("asks for a provider and stays disabled without one", () => {
    providerConfig.current = { ai_provider: "openai", ai_model: "", ai_keys: {} } as unknown as AppConfig;
    render(<AiCompletionModelSetting />);
    const row = screen.getByTestId("settings-ai-completion-model");
    expect(within(row).getByText(copy.needsProvider)).toBeInTheDocument();
    expect(within(row).getByRole("combobox", { name: "AI model" })).toBeDisabled();
  });
});
