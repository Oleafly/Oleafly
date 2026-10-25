// @vitest-environment jsdom
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import researchTools from "@/i18n/locales/en/researchTools.json" with { type: "json" };
import type { AppConfig, ModelMetadata } from "@/lib/tauri";

const mocks = vi.hoisted(() => ({
  getConfig: vi.fn(),
  setAiToolsModel: vi.fn(),
  listOllamaModelDetails: vi.fn(),
  mathpixKeyStatus: vi.fn(),
  notifyError: vi.fn(),
}));

vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  getConfig: mocks.getConfig,
  setAiToolsModel: mocks.setAiToolsModel,
}));
vi.mock("@/lib/ollama", () => ({
  DEFAULT_OLLAMA_HOST: "http://127.0.0.1:11434",
  listOllamaModelDetails: mocks.listOllamaModelDetails,
}));
vi.mock("@/lib/mathpix", () => ({ mathpixKeyStatus: mocks.mathpixKeyStatus }));
vi.mock("@/lib/toast", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/toast")>()),
  notifyError: mocks.notifyError,
}));

import { resetProviderConfigCache } from "@/components/ai/provider-config";
import { useSettingsStore } from "@/store/settings";
import { openToolsSettings, ScanEstimateText, ToolsModelNotice, ToolsModelPicker } from "./ToolsModelBar";

Element.prototype.scrollIntoView = vi.fn();

const model = researchTools.converterModel;

function config(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    ai_keys: {},
    ai_provider: "",
    ai_model: "",
    ai_api_key: "",
    ai_provider_models: {},
    ai_custom_providers: [],
    ...overrides,
  } as AppConfig;
}

function renderWithQuery(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

function openPicker() {
  fireEvent.click(screen.getByRole("combobox", { name: "AI model" }));
}

const letter = { width: 612, height: 792 };

beforeEach(() => {
  vi.clearAllMocks();
  resetProviderConfigCache();
  mocks.getConfig.mockResolvedValue(config());
  mocks.setAiToolsModel.mockResolvedValue(undefined);
  mocks.listOllamaModelDetails.mockResolvedValue([]);
  mocks.mathpixKeyStatus.mockResolvedValue({ configured: false, appId: null });
});

describe("Tools model picker", () => {
  it("lists Automatic, local vision models, hosted vision models and Mathpix", async () => {
    mocks.getConfig.mockResolvedValue(
      config({ ai_keys: { ollama: "http://127.0.0.1:11434", anthropic: "__stored__" } }),
    );
    mocks.listOllamaModelDetails.mockResolvedValue([
      { name: "glm-ocr", capabilities: ["completion", "vision"] },
      { name: "llama3.2", capabilities: ["completion", "tools"] },
    ]);
    mocks.mathpixKeyStatus.mockResolvedValue({ configured: true, appId: "APP" });
    renderWithQuery(<ToolsModelPicker />);
    await waitFor(() => expect(mocks.listOllamaModelDetails).toHaveBeenCalledWith("http://127.0.0.1:11434"));
    await waitFor(() => expect(mocks.mathpixKeyStatus).toHaveBeenCalled());
    expect(screen.getByTestId("tools-model-picker")).toHaveAccessibleName(model.label);
    openPicker();
    expect(await screen.findByTestId("ai-model-option-ollama-glm-ocr")).toBeInTheDocument();
    expect(screen.getByTestId("ai-model-option-ollama-")).toHaveTextContent(model.automatic);
    expect(screen.queryByTestId("ai-model-option-ollama-llama3.2")).not.toBeInTheDocument();
    expect(screen.getByTestId("ai-model-option-anthropic-claude-opus-5-5")).toBeInTheDocument();
    expect(await screen.findByTestId("ai-model-option-mathpix-mathpix")).toHaveTextContent(model.mathpixModel);
  });

  it("saves a hosted choice and tells every listener", async () => {
    const fresh = config({
      ai_keys: { anthropic: "__stored__" },
      ai_tools_model: { provider: "anthropic", model: "claude-opus-5-5" },
    });
    mocks.getConfig.mockResolvedValueOnce(config({ ai_keys: { anthropic: "__stored__" } })).mockResolvedValue(fresh);
    const events: unknown[] = [];
    const listener = (event: Event) => events.push((event as CustomEvent).detail);
    window.addEventListener("oleafly:ai-config-changed", listener);
    try {
      renderWithQuery(<ToolsModelPicker />);
      await waitFor(() => expect(mocks.getConfig).toHaveBeenCalled());
      openPicker();
      fireEvent.click(await screen.findByTestId("ai-model-option-anthropic-claude-opus-5-5"));
      await waitFor(() =>
        expect(mocks.setAiToolsModel).toHaveBeenCalledWith({ provider: "anthropic", model: "claude-opus-5-5" }),
      );
      await waitFor(() => expect(events).toEqual([fresh]));
    } finally {
      window.removeEventListener("oleafly:ai-config-changed", listener);
    }
  });

  it("choosing Automatic clears the choice", async () => {
    mocks.getConfig.mockResolvedValue(
      config({
        ai_keys: { anthropic: "__stored__" },
        ai_tools_model: { provider: "anthropic", model: "claude-opus-5-5" },
      }),
    );
    renderWithQuery(<ToolsModelPicker />);
    await waitFor(() => expect(mocks.getConfig).toHaveBeenCalled());
    openPicker();
    fireEvent.click(await screen.findByTestId("ai-model-option-ollama-"));
    await waitFor(() => expect(mocks.setAiToolsModel).toHaveBeenCalledWith(null));
  });

  it("reports a choice the backend refused", async () => {
    mocks.setAiToolsModel.mockRejectedValue("Pick a model for Tools.");
    mocks.getConfig.mockResolvedValue(config({ ai_keys: { anthropic: "__stored__" } }));
    renderWithQuery(<ToolsModelPicker />);
    await waitFor(() => expect(mocks.getConfig).toHaveBeenCalled());
    openPicker();
    fireEvent.click(await screen.findByTestId("ai-model-option-anthropic-claude-opus-5-5"));
    await waitFor(() =>
      expect(mocks.notifyError).toHaveBeenCalledWith(
        "save the Tools model",
        "Pick a model for Tools.",
        "Pick a model for Tools.",
      ),
    );
  });
});

describe("Tools model notice", () => {
  it("says Runs on this device for local models", async () => {
    renderWithQuery(<ToolsModelNotice scope="images" />);
    const notice = await screen.findByTestId("tools-model-notice");
    expect(notice).toHaveAttribute("data-destination", "device");
    expect(notice).toHaveTextContent(researchTools.converter.runsOnDevice);
  });

  it.each([
    [
      config({ ai_keys: { anthropic: "__stored__" }, ai_tools_model: { provider: "anthropic", model: "claude-opus-5-5" } }),
      "images" as const,
      "provider",
      "Images are sent to Anthropic",
    ],
    [
      config({ ai_keys: { anthropic: "__stored__" }, ai_tools_model: { provider: "anthropic", model: "claude-opus-5-5" } }),
      "scans" as const,
      "provider",
      "Scanned pages are sent to Anthropic",
    ],
    [config({ ai_keys: { ollama: "http://192.168.1.9:11434" } }), "images" as const, "host", "Images are sent to Ollama at 192.168.1.9:11434"],
    [config({ ai_keys: { ollama: "http://192.168.1.9:11434" } }), "scans" as const, "host", "Scanned pages are sent to Ollama at 192.168.1.9:11434"],
    [config({ ai_tools_model: { provider: "mathpix", model: "mathpix" } }), "scans" as const, "provider", "The whole PDF is sent to Mathpix"],
    [config({ ai_tools_model: { provider: "mathpix", model: "mathpix" } }), "images" as const, "provider", "Images are sent to Mathpix"],
  ])("names the provider for hosted models and the host for a remote Ollama (%#)", async (cfg, scope, kind, text) => {
    mocks.getConfig.mockResolvedValue(cfg);
    renderWithQuery(<ToolsModelNotice scope={scope} />);
    await waitFor(() => expect(screen.getByTestId("tools-model-notice")).toHaveAttribute("data-destination", kind));
    expect(screen.getByTestId("tools-model-notice")).toHaveTextContent(text);
  });

  it("names Ollama Cloud for a picked cloud model instead of this device", async () => {
    mocks.getConfig.mockResolvedValue(config({ ai_tools_model: { provider: "ollama", model: "qwen3-vl:235b-cloud" } }));
    renderWithQuery(<ToolsModelNotice scope="images" />);
    await waitFor(() => expect(screen.getByTestId("tools-model-notice")).toHaveAttribute("data-destination", "provider"));
    expect(screen.getByTestId("tools-model-notice")).toHaveTextContent("Images are sent to Ollama Cloud");
  });

  it("trusts Ollama's listing for a cloud model copied under a plain name", async () => {
    mocks.getConfig.mockResolvedValue(config({ ai_tools_model: { provider: "ollama", model: "my-vl" } }));
    mocks.listOllamaModelDetails.mockResolvedValue([
      { name: "my-vl", capabilities: ["completion", "vision"], remote: true },
    ]);
    renderWithQuery(<ToolsModelNotice scope="scans" />);
    await waitFor(() => expect(screen.getByTestId("tools-model-notice")).toHaveAttribute("data-destination", "provider"));
    expect(screen.getByTestId("tools-model-notice")).toHaveTextContent("Scanned pages are sent to Ollama Cloud");
  });

  describe("with Automatic and a hosted assistant model that reads images", () => {
    const assistant = config({
      ai_provider: "anthropic",
      ai_model: "claude-opus-5-5",
      ai_keys: { anthropic: "__stored__" },
      ai_provider_models: {
        anthropic: [
          {
            id: "claude-opus-5-5",
            name: "Claude Opus 5.5",
            enabled: true,
            source: "fetched",
            metadata: {
              name: "Claude Opus 5.5",
              inputModalities: ["text", "image"],
              outputModalities: ["text"],
              toolCall: true,
              reasoning: true,
              attachment: true,
              structuredOutput: true,
              status: "active",
            },
          },
        ],
      },
    });
    const fallback = model.editorFallback.replace("{{provider}}", "Anthropic");

    it("says the editor sends images to the assistant's provider while Ollama cannot read them", async () => {
      mocks.getConfig.mockResolvedValue(assistant);
      mocks.listOllamaModelDetails.mockRejectedValue(new Error("connection refused"));
      renderWithQuery(<ToolsModelNotice scope="images" />);
      await waitFor(() =>
        expect(screen.getByTestId("tools-model-notice")).toHaveAttribute("data-destination", "assistant"),
      );
      expect(screen.getByTestId("tools-model-notice")).toHaveTextContent(fallback);
    });

    it("keeps Runs on this device once Ollama has a vision model, and on converter pages", async () => {
      mocks.getConfig.mockResolvedValue(assistant);
      mocks.listOllamaModelDetails.mockResolvedValue([{ name: "llava", capabilities: ["completion", "vision"] }]);
      const withModel = renderWithQuery(<ToolsModelNotice scope="images" />);
      await waitFor(() => expect(mocks.listOllamaModelDetails).toHaveBeenCalled());
      await waitFor(() =>
        expect(screen.getByTestId("tools-model-notice")).toHaveAttribute("data-destination", "device"),
      );
      withModel.unmount();

      mocks.listOllamaModelDetails.mockReset().mockRejectedValue(new Error("connection refused"));
      renderWithQuery(<ToolsModelNotice scope="images" editorFallback={false} />);
      await waitFor(() =>
        expect(screen.getByTestId("tools-model-notice")).toHaveAttribute("data-destination", "device"),
      );
      expect(mocks.listOllamaModelDetails).not.toHaveBeenCalled();
    });
  });
});

describe("Scan estimate", () => {
  const opus: ModelMetadata = {
    name: "Claude Opus 5.5",
    inputModalities: ["text", "image"],
    outputModalities: ["text"],
    toolCall: true,
    reasoning: true,
    attachment: true,
    structuredOutput: true,
    status: "active",
    cost: { input: 4, output: 20 },
  };

  it("shows the Ollama, cost and unknown estimates", async () => {
    const local = renderWithQuery(<ScanEstimateText sizes={[letter, letter, letter]} />);
    expect(await screen.findByTestId("scan-estimate")).toHaveTextContent(
      model.estimateOllama_other.replace("{{count}}", "3"),
    );
    local.unmount();

    resetProviderConfigCache();
    mocks.getConfig.mockResolvedValue(
      config({
        ai_keys: { anthropic: "__stored__" },
        ai_tools_model: { provider: "anthropic", model: "claude-opus-5-5" },
        ai_provider_models: {
          anthropic: [{ id: "claude-opus-5-5", name: "Claude Opus 5.5", enabled: true, source: "fetched", metadata: opus }],
        },
      }),
    );
    const priced = renderWithQuery(<ScanEstimateText sizes={[letter, letter]} />);
    await waitFor(() =>
      expect(screen.getByTestId("scan-estimate")).toHaveTextContent("2 pages. About $0.06 with Claude Opus 5.5."),
    );
    priced.unmount();

    resetProviderConfigCache();
    mocks.getConfig.mockResolvedValue(
      config({ ai_keys: { anthropic: "__stored__" }, ai_tools_model: { provider: "anthropic", model: "vision-x-unpriced" } }),
    );
    renderWithQuery(<ScanEstimateText sizes={[letter]} />);
    await waitFor(() =>
      expect(screen.getByTestId("scan-estimate")).toHaveTextContent("1 page. Anthropic bills this by usage."),
    );
  });

  it("shows the plan, local and free estimates", async () => {
    mocks.getConfig.mockResolvedValue(config({ ai_tools_model: { provider: "ollama", model: "qwen3-vl:235b-cloud" } }));
    const cloud = renderWithQuery(<ScanEstimateText sizes={[letter, letter]} />);
    await waitFor(() =>
      expect(screen.getByTestId("scan-estimate")).toHaveTextContent("2 pages. Ollama Cloud includes these in your plan."),
    );
    cloud.unmount();

    resetProviderConfigCache();
    mocks.getConfig.mockResolvedValue(
      config({
        ai_custom_providers: [
          { id: "lmstudio", name: "LM Studio", baseURL: "http://localhost:1234/v1", keyOptional: true },
        ],
        ai_tools_model: { provider: "lmstudio", model: "qwen2.5vl-unpriced" },
      }),
    );
    const local = renderWithQuery(<ScanEstimateText sizes={[letter]} />);
    await waitFor(() =>
      expect(screen.getByTestId("scan-estimate")).toHaveTextContent(
        "1 page. The model runs on this computer, at no cost.",
      ),
    );
    local.unmount();

    resetProviderConfigCache();
    mocks.getConfig.mockResolvedValue(
      config({
        ai_keys: { openrouter: "__stored__" },
        ai_tools_model: { provider: "openrouter", model: "vision-free" },
        ai_provider_models: {
          openrouter: [
            {
              id: "vision-free",
              name: "Vision Free",
              enabled: true,
              source: "fetched",
              metadata: { ...opus, cost: { input: 0, output: 0 } },
            },
          ],
        },
      }),
    );
    renderWithQuery(<ScanEstimateText sizes={[letter, letter, letter]} />);
    await waitFor(() =>
      expect(screen.getByTestId("scan-estimate")).toHaveTextContent("3 pages. Free with Vision Free."),
    );
  });

  it("shows at least one cent for a tiny Mathpix run", async () => {
    mocks.getConfig.mockResolvedValue(config({ ai_tools_model: { provider: "mathpix", model: "mathpix" } }));
    renderWithQuery(<ScanEstimateText sizes={[letter]} />);
    await waitFor(() =>
      expect(screen.getByTestId("scan-estimate")).toHaveTextContent("1 page. About $0.01 with Mathpix OCR."),
    );
  });
});

describe("Tools settings link", () => {
  it("opens Settings on AI, or on its Tools tab", () => {
    useSettingsStore.setState({ settingsOpen: false, settingsInitialSection: "general", settingsScrollTarget: null });
    openToolsSettings("ai");
    expect(useSettingsStore.getState()).toMatchObject({
      settingsOpen: true,
      settingsInitialSection: "ai",
      settingsScrollTarget: null,
    });
    openToolsSettings("ai-tools");
    expect(useSettingsStore.getState().settingsScrollTarget).toBe("ai-tools");
  });

  it("opens Providers and keys, where keys and model switches live, for a key or model problem", () => {
    useSettingsStore.setState({ settingsOpen: false, settingsInitialSection: "general", settingsScrollTarget: null });
    openToolsSettings("ai-providers");
    expect(useSettingsStore.getState()).toMatchObject({
      settingsOpen: true,
      settingsInitialSection: "ai",
      settingsScrollTarget: null,
    });
  });
});
