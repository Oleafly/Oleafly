import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getConfig: vi.fn() }));

vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  getConfig: mocks.getConfig,
}));

import { useAgentHandoffStore } from "@/store/agent-handoff";
import { useSettingsStore } from "@/store/settings";
import { ensureAiProviderOrOpenSettings, handoffToAssistant, revealAssistant } from "./assistant-handoff";

beforeEach(() => {
  mocks.getConfig.mockReset();
  useAgentHandoffStore.setState({ pendingPrompt: null, autoSend: false, pendingImages: [] });
  useSettingsStore.setState({
    chatFloating: false,
    assistantOpen: false,
    settingsOpen: false,
    settingsInitialSection: "general",
  });
});

describe("assistant handoff", () => {
  it("opens the docked assistant but leaves a floating one alone", () => {
    revealAssistant();
    expect(useSettingsStore.getState().assistantOpen).toBe(true);

    useSettingsStore.setState({ assistantOpen: false, chatFloating: true });
    revealAssistant();
    expect(useSettingsStore.getState().assistantOpen).toBe(false);
  });

  it("hands a prompt and images to the assistant without sending it by default", () => {
    handoffToAssistant("Explain this error", { images: ["data:image/png;base64,AA"] });

    expect(useAgentHandoffStore.getState()).toMatchObject({
      pendingPrompt: "Explain this error",
      autoSend: false,
      pendingImages: ["data:image/png;base64,AA"],
    });
    expect(useSettingsStore.getState().assistantOpen).toBe(true);
  });

  it("can send the handed-off prompt right away", () => {
    handoffToAssistant("Summarize", { autoSend: true });

    expect(useAgentHandoffStore.getState()).toMatchObject({ pendingPrompt: "Summarize", autoSend: true, pendingImages: [] });
  });

  it("continues when a provider is configured", async () => {
    mocks.getConfig.mockResolvedValue({ ai_keys: { groq: "gsk_test" } });

    await expect(ensureAiProviderOrOpenSettings()).resolves.toBe(true);
    expect(useSettingsStore.getState().settingsOpen).toBe(false);
  });

  it("opens the AI settings when no provider is configured or the config cannot be read", async () => {
    mocks.getConfig.mockResolvedValue({ ai_provider: "anthropic", ai_keys: { anthropic: "  " } });
    await expect(ensureAiProviderOrOpenSettings()).resolves.toBe(false);
    expect(useSettingsStore.getState()).toMatchObject({ settingsOpen: true, settingsInitialSection: "ai" });

    useSettingsStore.setState({ settingsOpen: false, settingsInitialSection: "general" });
    mocks.getConfig.mockRejectedValue(new Error("config unavailable"));
    await expect(ensureAiProviderOrOpenSettings()).resolves.toBe(false);
    expect(useSettingsStore.getState()).toMatchObject({ settingsOpen: true, settingsInitialSection: "ai" });
  });
});
