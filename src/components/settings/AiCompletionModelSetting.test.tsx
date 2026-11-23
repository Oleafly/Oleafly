// @vitest-environment jsdom

import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import enSettings from "@/i18n/locales/en/settings.json" with { type: "json" };
import type { AppConfig, StoredModel } from "@/lib/tauri";
import { useSettingsStore } from "@/store/settings";
import { AiCompletionModelSetting } from "./AiCompletionModelSetting";

Element.prototype.scrollIntoView = vi.fn();

const copy = enSettings.ai.instructions;
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
  localStorage.clear();
});

describe("AI completion model", () => {
  it("starts on the default model and saves the model picked for completions", () => {
    render(<AiCompletionModelSetting config={CONFIGURED} />);
    const row = screen.getByTestId("settings-ai-completion-model");
    expect(within(row).getByText(copy.completionModelTitle)).toBeInTheDocument();
    expect(within(row).getByText(copy.completionModelDescription)).toBeInTheDocument();
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

  it("stays disabled without a configured provider", () => {
    const empty = { ai_provider: "openai", ai_model: "", ai_keys: {} } as unknown as AppConfig;
    render(<AiCompletionModelSetting config={empty} />);
    const row = screen.getByTestId("settings-ai-completion-model");
    expect(within(row).getByRole("combobox", { name: "AI model" })).toBeDisabled();
  });
});
