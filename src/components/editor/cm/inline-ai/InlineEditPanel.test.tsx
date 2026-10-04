// @vitest-environment jsdom
import { act, fireEvent, getDefaultNormalizer, render, screen, waitFor } from "@testing-library/react";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import core from "@/i18n/locales/en/core.json" with { type: "json" };
import en from "@/i18n/locales/en/editor.json" with { type: "json" };
import type { AppConfig } from "@/lib/tauri";
import { useFilesStore } from "@/store/files";
import { useInlineEditStore } from "@/store/inlineEdit";
import { useSettingsStore } from "@/store/settings";
import { useTourStore } from "@/store/tours";

const tauri = vi.hoisted(() => ({
  getConfig: vi.fn(async (): Promise<Partial<AppConfig>> => ({})),
  setConfig: vi.fn(async (_config: unknown) => {}),
}));
const inline = vi.hoisted(() => ({
  runInlineCompletion: vi.fn(
    async (_options: {
      instruction: string;
      selection: string;
      engine?: unknown;
      signal: AbortSignal;
      onToken: (full: string) => void;
    }) => {},
  ),
}));
const ollama = vi.hoisted(() => ({ listOllamaModels: vi.fn(async (_host: string) => [] as string[]) }));
const handoff = vi.hoisted(() => ({ handoffToAssistant: vi.fn() }));
const log = vi.hoisted(() => ({ logError: vi.fn(async (_scope: string, _error: unknown) => {}) }));

vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  ...tauri,
}));
vi.mock("@/lib/ai-inline", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai-inline")>()),
  ...inline,
}));
vi.mock("@/lib/ollama", () => ollama);
vi.mock("@/features/assistant-handoff", () => handoff);
vi.mock("@/lib/log", () => log);
vi.mock("@/components/ai/ModelSelector", () => ({
  ModelSelector: ({
    providerId,
    modelId,
    groups,
    onChange,
  }: {
    providerId: string;
    modelId: string;
    groups: { id: string; name: string; models: { id: string; name: string }[] }[];
    onChange: (providerId: string, modelId: string) => void;
  }) => (
    <div>
      <span data-testid="active-model">{`${providerId}:${modelId}`}</span>
      {groups.map((group) =>
        group.models.map((model) => (
          <button key={`${group.id}/${model.id}`} type="button" onClick={() => onChange(group.id, model.id)}>
            {`${group.id}/${model.id}`}
          </button>
        )),
      )}
    </div>
  ),
}));

import { setEditorView } from "@/components/editor/cm/controller";
import { InlineEditPanel } from "./InlineEditPanel";

const inlineAi = en.inlineAi;
const CONFIGURED = { ai_provider: "openai", ai_model: "gpt-4o-mini", ai_keys: { openai: "sk-test" } };

let view: EditorView | null = null;

function promptBox() {
  return screen.getByPlaceholderText(inlineAi.promptPlaceholder, {
    normalizer: getDefaultNormalizer({ collapseWhitespace: false }),
  });
}

function openSession(overrides: Partial<{ instruction: string; autoRun: boolean }> = {}) {
  useInlineEditStore.getState().open({ from: 0, to: 5, original: "hello", ...overrides });
}

async function renderPanel() {
  const result = render(<InlineEditPanel />);
  await waitFor(() => expect(tauri.getConfig).toHaveBeenCalled());
  await act(async () => {});
  return result;
}

function setPhase(phase: "prompting" | "streaming" | "reviewing" | "error", extra: object = {}) {
  act(() => {
    useInlineEditStore.setState((state) =>
      state.session ? { session: { ...state.session, phase, ...extra } } : state,
    );
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  tauri.getConfig.mockResolvedValue(CONFIGURED);
  ollama.listOllamaModels.mockResolvedValue([]);
  inline.runInlineCompletion.mockResolvedValue(undefined);
  useInlineEditStore.getState().reset();
  useTourStore.setState({ activeTourId: null });
  useSettingsStore.setState({ settingsOpen: false });
  view = new EditorView({ state: EditorState.create({ doc: "hello world" }), parent: document.body });
  setEditorView(view);
});

afterEach(() => {
  setEditorView(null);
  view?.destroy();
  view = null;
  useInlineEditStore.getState().reset();
});

describe("InlineEditPanel", () => {
  it("renders nothing without a session", async () => {
    const { container } = await renderPanel();
    expect(container).toBeEmptyDOMElement();
  });

  it("asks for a provider first and opens the AI settings", async () => {
    tauri.getConfig.mockResolvedValue({});
    openSession();
    await renderPanel();
    expect(screen.getByText(inlineAi.setUpProvider)).toBeInTheDocument();
    expect(screen.getByText(inlineAi.setUpProviderHint)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: inlineAi.openAiSettings }));
    expect(useInlineEditStore.getState().session).toBeNull();
    expect(useSettingsStore.getState().settingsOpen).toBe(true);
    expect(useSettingsStore.getState().settingsInitialSection).toBe("ai");
  });

  it("keeps the prompt usable when the config cannot be read", async () => {
    tauri.getConfig.mockRejectedValue(new Error("no config"));
    openSession();
    await renderPanel();
    expect(promptBox()).toBeEnabled();
  });

  it("streams a typed instruction and then shows the review actions", async () => {
    useFilesStore.setState({ engineLoaded: false });
    openSession();
    await renderPanel();
    inline.runInlineCompletion.mockImplementation(async ({ onToken }) => {
      onToken("Hello");
      onToken("Hello there");
    });
    fireEvent.change(promptBox(), { target: { value: "  Make it friendlier  " } });
    expect(useInlineEditStore.getState().session?.instruction).toBe("  Make it friendlier  ");
    fireEvent.click(screen.getByLabelText(inlineAi.submit));
    await screen.findByLabelText(inlineAi.accept);
    expect(inline.runInlineCompletion).toHaveBeenCalledWith(
      expect.objectContaining({ instruction: "Make it friendlier", selection: "hello", engine: undefined }),
    );
    expect(useInlineEditStore.getState().session).toMatchObject({
      phase: "reviewing",
      instruction: "Make it friendlier",
      proposed: "Hello there",
    });
  });

  it("passes the loaded document engine and runs a preset", async () => {
    const engine = useFilesStore.getState().engine;
    useFilesStore.setState({ engineLoaded: true });
    openSession();
    await renderPanel();
    fireEvent.click(screen.getByText(core.inlineAi.grammar));
    await screen.findByLabelText(inlineAi.accept);
    expect(inline.runInlineCompletion).toHaveBeenCalledWith(
      expect.objectContaining({
        instruction: "Fix any spelling and grammar mistakes in the selected text.",
        engine,
      }),
    );
  });

  it("shows a failure with retry and dismiss", async () => {
    openSession({ instruction: "Shorten" });
    await renderPanel();
    const failure = new Error("provider timed out");
    inline.runInlineCompletion.mockRejectedValue(failure);
    fireEvent.click(screen.getByLabelText(inlineAi.submit));
    await screen.findByText(inlineAi.generateFailed.replace("{{message}}", "provider timed out"));
    expect(log.logError).toHaveBeenCalledWith("ai", failure);

    fireEvent.click(screen.getByText(inlineAi.retry));
    expect(useInlineEditStore.getState().session).toMatchObject({ phase: "prompting", proposed: "" });
    expect(promptBox()).toBeInTheDocument();

    setPhase("error", { error: undefined });
    fireEvent.click(screen.getByText(inlineAi.dismiss));
    expect(useInlineEditStore.getState().session).toBeNull();
  });

  it("stops a running request without reporting it as a failure", async () => {
    openSession({ instruction: "Shorten" });
    await renderPanel();
    let signal: AbortSignal | null = null;
    inline.runInlineCompletion.mockImplementation(
      (options) =>
        new Promise((_resolve, reject) => {
          signal = options.signal;
          options.signal.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );
    fireEvent.click(screen.getByLabelText(inlineAi.submit));
    expect(await screen.findByText(inlineAi.thinking)).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(inlineAi.stop));
    await act(async () => {});
    expect((signal as AbortSignal | null)?.aborted).toBe(true);
    expect(useInlineEditStore.getState().session).toBeNull();
    expect(log.logError).not.toHaveBeenCalled();
  });

  it("aborts an in-flight request when it unmounts", async () => {
    openSession({ instruction: "Shorten" });
    const { unmount } = await renderPanel();
    let signal: AbortSignal | null = null;
    inline.runInlineCompletion.mockImplementation((options) => {
      signal = options.signal;
      return new Promise(() => {});
    });
    fireEvent.click(screen.getByLabelText(inlineAi.submit));
    await waitFor(() => expect(signal).not.toBeNull());
    unmount();
    expect((signal as AbortSignal | null)?.aborted).toBe(true);
  });

  it("accepts the proposal into the editor", async () => {
    openSession({ instruction: "Capitalise" });
    await renderPanel();
    setPhase("reviewing", { proposed: "HELLO" });
    fireEvent.click(screen.getByLabelText(inlineAi.accept));
    expect(view?.state.doc.toString()).toBe("HELLO world");
    expect(useInlineEditStore.getState().session).toBeNull();
  });

  it("rejects the proposal without touching the editor", async () => {
    openSession({ instruction: "Capitalise" });
    await renderPanel();
    setPhase("reviewing", { proposed: "HELLO" });
    fireEvent.click(screen.getByLabelText(inlineAi.reject));
    expect(view?.state.doc.toString()).toBe("hello world");
    expect(useInlineEditStore.getState().session).toBeNull();
  });

  it("ignores accept and reject when no editor is mounted", async () => {
    setEditorView(null);
    openSession({ instruction: "Capitalise" });
    await renderPanel();
    setPhase("reviewing", { proposed: "HELLO" });
    fireEvent.click(screen.getByLabelText(inlineAi.accept));
    fireEvent.click(screen.getByLabelText(inlineAi.reject));
    expect(useInlineEditStore.getState().session?.phase).toBe("reviewing");
  });

  it("hands the edit over to the assistant", async () => {
    openSession({ instruction: "Capitalise" });
    await renderPanel();
    setPhase("reviewing", { proposed: "HELLO" });
    fireEvent.click(screen.getByLabelText(inlineAi.openInAgent));
    const [prompt, options] = handoff.handoffToAssistant.mock.calls[0];
    expect(prompt).toContain("Instruction: Capitalise");
    expect(prompt).toContain("Original selection:\n```\nhello\n```");
    expect(prompt).toContain("Proposed rewrite so far:\n```\nHELLO\n```");
    expect(options).toEqual({ autoSend: true });
    expect(useInlineEditStore.getState().session).toBeNull();
  });

  it("hands over a bare selection when there is no instruction or proposal yet", async () => {
    openSession();
    await renderPanel();
    setPhase("reviewing", { proposed: "" });
    fireEvent.click(screen.getByLabelText(inlineAi.openInAgent));
    const [prompt] = handoff.handoffToAssistant.mock.calls[0];
    expect(prompt).toContain("Instruction: (no instruction)");
    expect(prompt).not.toContain("Proposed rewrite so far");
  });

  describe("keyboard", () => {
    function key(name: string) {
      const event = new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true });
      act(() => {
        window.dispatchEvent(event);
      });
      return event;
    }

    it("accepts with Enter and rejects with Escape while reviewing", async () => {
      openSession({ instruction: "Capitalise" });
      await renderPanel();
      setPhase("reviewing", { proposed: "HELLO" });
      expect(key("Enter").defaultPrevented).toBe(true);
      expect(view?.state.doc.toString()).toBe("HELLO world");

      act(() => openSession({ instruction: "Again" }));
      setPhase("reviewing", { proposed: "HOWDY" });
      key("Escape");
      expect(useInlineEditStore.getState().session).toBeNull();
      expect(view?.state.doc.toString()).toBe("HELLO world");
    });

    it("closes the prompt with Escape and leaves Enter to the prompt box", async () => {
      openSession();
      await renderPanel();
      expect(key("Enter").defaultPrevented).toBe(false);
      expect(useInlineEditStore.getState().session).not.toBeNull();
      key("Escape");
      expect(useInlineEditStore.getState().session).toBeNull();
    });

    it("stops a stream with Escape", async () => {
      openSession({ instruction: "Shorten" });
      await renderPanel();
      let signal: AbortSignal | null = null;
      inline.runInlineCompletion.mockImplementation((options) => {
        signal = options.signal;
        return new Promise(() => {});
      });
      fireEvent.click(screen.getByLabelText(inlineAi.submit));
      await screen.findByText(inlineAi.thinking);
      key("Escape");
      expect((signal as AbortSignal | null)?.aborted).toBe(true);
      expect(useInlineEditStore.getState().session).toBeNull();
    });

    it("leaves the keys to a running tour", async () => {
      useTourStore.setState({ activeTourId: "editor" as never });
      openSession();
      await renderPanel();
      key("Escape");
      expect(useInlineEditStore.getState().session).not.toBeNull();
    });
  });

  describe("auto-run presets", () => {
    it("runs the chosen instruction once the provider is known", async () => {
      openSession({ instruction: "Translate it", autoRun: true });
      await renderPanel();
      await screen.findByLabelText(inlineAi.accept);
      expect(inline.runInlineCompletion).toHaveBeenCalledOnce();
      expect(inline.runInlineCompletion.mock.calls[0][0].instruction).toBe("Translate it");
      expect(useInlineEditStore.getState().session?.autoRun).toBe(false);
    });

    it("waits when no provider is configured", async () => {
      tauri.getConfig.mockResolvedValue({});
      openSession({ instruction: "Translate it", autoRun: true });
      await renderPanel();
      expect(inline.runInlineCompletion).not.toHaveBeenCalled();
      expect(useInlineEditStore.getState().session?.autoRun).toBe(true);
    });
  });

  describe("model choice", () => {
    it("lists configured providers, local Ollama models and a custom active model", async () => {
      tauri.getConfig.mockResolvedValue({
        ai_provider: "openai",
        ai_model: "my-finetune",
        ai_keys: { openai: "sk", ollama: "http://localhost:11434", google: "  " },
      });
      ollama.listOllamaModels.mockResolvedValue(["llama3"]);
      openSession();
      await renderPanel();
      await screen.findByText("ollama/llama3");
      expect(ollama.listOllamaModels).toHaveBeenCalledWith("http://localhost:11434");
      expect(screen.getByTestId("active-model")).toHaveTextContent("openai:my-finetune");
      expect(screen.getByText("openai/my-finetune")).toBeInTheDocument();
      expect(screen.getByText("openai/gpt-4o-mini")).toBeInTheDocument();
      expect(screen.queryByText(/^google\//)).not.toBeInTheDocument();
    });

    it("falls back to the stock Ollama list when the local server does not answer", async () => {
      tauri.getConfig.mockResolvedValue({ ai_provider: "ollama", ai_keys: { ollama: "http://localhost:11434" } });
      ollama.listOllamaModels.mockRejectedValue(new Error("offline"));
      openSession();
      await renderPanel();
      await waitFor(() => expect(ollama.listOllamaModels).toHaveBeenCalled());
      expect(screen.queryByText("ollama/llama3")).not.toBeInTheDocument();
      expect(screen.getAllByText(/^ollama\//).length).toBeGreaterThan(0);
    });

    it("treats a legacy single API key as the saved provider's key", async () => {
      tauri.getConfig.mockResolvedValue({ ai_provider: "anthropic", ai_api_key: "legacy" });
      openSession();
      await renderPanel();
      expect(screen.getAllByText(/^anthropic\//).length).toBeGreaterThan(0);
    });

    it("saves the chosen model and announces the change", async () => {
      openSession();
      await renderPanel();
      const announced = vi.fn();
      window.addEventListener("oleafly:ai-config-changed", announced);
      fireEvent.click(screen.getByText("openai/gpt-5.6-sol"));
      await waitFor(() => expect(tauri.setConfig).toHaveBeenCalled());
      window.removeEventListener("oleafly:ai-config-changed", announced);
      expect(tauri.setConfig).toHaveBeenCalledWith(
        expect.objectContaining({ ai_provider: "openai", ai_model: "gpt-5.6-sol" }),
      );
      await waitFor(() => expect(announced).toHaveBeenCalledOnce());
      expect(screen.getByTestId("active-model")).toHaveTextContent("openai:gpt-5.6-sol");
    });

    it("reloads the config when another surface changes it", async () => {
      openSession();
      await renderPanel();
      tauri.getConfig.mockResolvedValue({});
      act(() => {
        window.dispatchEvent(new Event("oleafly:ai-config-changed"));
      });
      await screen.findByText(inlineAi.setUpProvider);
      act(() => {
        window.dispatchEvent(
          new CustomEvent("oleafly:ai-config-changed", { detail: CONFIGURED }),
        );
      });
      expect(promptBox()).toBeInTheDocument();
    });
  });
});
