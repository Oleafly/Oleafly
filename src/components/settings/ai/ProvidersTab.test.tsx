// @vitest-environment jsdom

import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import enCommon from "@/i18n/locales/en/common.json" with { type: "json" };
import enSettings from "@/i18n/locales/en/settings.json" with { type: "json" };
import type { AppConfig } from "@/lib/tauri";
import { agentModelMetadataStatus } from "@/lib/tauri";
import { createAppQueryClient } from "@/lib/query";
import { ProvidersTab, type ProvidersTabProps } from "./ProvidersTab";

const shell = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock("@tauri-apps/plugin-shell", () => ({ open: shell.open }));
vi.mock("@/lib/ollama", () => ({
  DEFAULT_OLLAMA_HOST: "http://127.0.0.1:11434",
  listOllamaModels: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  agentListModels: vi.fn(),
  agentModelMetadataStatus: vi.fn(),
  agentRefreshModelMetadata: vi.fn(),
}));

const cfg = {
  ai_provider: "",
  ai_model: "",
  ai_keys: {},
  ai_provider_models: {},
  ai_custom_providers: [],
} as unknown as AppConfig;

function renderTab(overrides: Partial<ProvidersTabProps> = {}) {
  const props: ProvidersTabProps = {
    cfg,
    keys: {},
    savedKeys: {},
    saving: null,
    openProviders: {},
    setOpenProviders: vi.fn(),
    setKeys: vi.fn(),
    ollama: { status: "idle", models: [], installed: false, starting: false },
    onStartOllama: vi.fn(),
    refreshOllama: vi.fn().mockResolvedValue(undefined),
    applyOllamaModel: vi.fn().mockResolvedValue(undefined),
    validateAndSave: vi.fn().mockResolvedValue(undefined),
    status: {},
    errorMsg: {},
    changeModel: vi.fn().mockResolvedValue(undefined),
    deleteKey: vi.fn().mockResolvedValue(undefined),
    persistModels: vi.fn().mockResolvedValue(undefined),
    persistRefreshedModels: vi.fn().mockResolvedValue(undefined),
    onAddCustomProvider: vi.fn(),
    onEditCustomProvider: vi.fn(),
    deleteCustomProvider: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  const view = render(
    <QueryClientProvider client={createAppQueryClient()}>
      <ProvidersTab {...props} />
    </QueryClientProvider>,
  );
  return {
    props,
    rerender: (next: Partial<ProvidersTabProps>) =>
      view.rerender(
        <QueryClientProvider client={createAppQueryClient()}>
          <ProvidersTab {...props} {...next} />
        </QueryClientProvider>,
      ),
  };
}

describe("ProvidersTab", () => {
  it("keeps the tour target on the add button alone", async () => {
    vi.mocked(agentModelMetadataStatus).mockResolvedValue({
      source: "bundled",
      generatedAt: "2026-08-20T12:00:00Z",
      refreshedAt: null,
    });
    renderTab();

    const target = document.querySelector('[data-tour="ai-settings-custom-provider"]');
    expect(target).not.toBeNull();
    expect(within(target as HTMLElement).getByTestId("ai-add-custom-provider")).toBeInTheDocument();
    const status = await screen.findByTestId("ai-model-metadata-status");
    expect(target).not.toContainElement(status);
  });

  it("renders the Ollama setup steps with their links and commands intact", () => {
    vi.mocked(agentModelMetadataStatus).mockResolvedValue({
      source: "bundled",
      generatedAt: "2026-08-20T12:00:00Z",
      refreshedAt: null,
    });
    renderTab({
      openProviders: { ollama: true },
      ollama: { status: "down", models: [], installed: false, starting: false },
    });

    const card = screen.getByTestId("ai-provider-card-ollama");
    const plain = (value: string) => {
      let text = value;
      let previous = "";
      while (text !== previous) {
        previous = text;
        text = text.replace(/<[^>]*>/gu, "");
      }
      return text.replace(/\s+/gu, " ").trim();
    };
    expect(card).toHaveTextContent(
      plain(enSettings.ai.providers.ollama.noneResponding).replace(
        "{{host}}",
        "http://127.0.0.1:11434",
      ),
    );
    expect(card).toHaveTextContent(plain(enSettings.ai.providers.ollama.setupSteps));
    expect(within(card).getByRole("button", { name: /ollama\.com/u })).toBeInTheDocument();
  });

  it("counts running Ollama models with the plural forms", () => {
    vi.mocked(agentModelMetadataStatus).mockResolvedValue({
      source: "bundled",
      generatedAt: "2026-08-20T12:00:00Z",
      refreshedAt: null,
    });
    renderTab({
      openProviders: { ollama: true },
      ollama: { status: "ok", models: ["llama3.2"], installed: true, starting: false },
    });

    const card = screen.getByTestId("ai-provider-card-ollama");
    expect(card).toHaveTextContent(
      enSettings.ai.providers.ollama.runningModels_one.replace("{{count}}", "1"),
    );
  });
});

const providers = enSettings.ai.providers;

beforeEach(() => {
  shell.open.mockClear();
  vi.mocked(agentModelMetadataStatus).mockResolvedValue({
    source: "bundled",
    generatedAt: "2026-08-20T12:00:00Z",
    refreshedAt: null,
  });
});

describe("ProvidersTab provider cards", () => {
  it("keeps a collapsed card to its name and expands it on request", async () => {
    const user = userEvent.setup();
    const setOpenProviders = vi.fn();
    renderTab({ setOpenProviders });

    const card = screen.getByTestId("ai-provider-card-openai");
    expect(within(card).queryByText(providers.blurbs.openai)).not.toBeInTheDocument();
    expect(screen.queryByTestId("ai-provider-key-openai")).not.toBeInTheDocument();

    await user.click(within(card).getByRole("button", { expanded: false }));
    expect(setOpenProviders).toHaveBeenCalled();
  });

  it("shows the blurb, the signup link, and the key field on an open unconfigured card", async () => {
    const user = userEvent.setup();
    renderTab({ openProviders: { openai: true } });

    const card = screen.getByTestId("ai-provider-card-openai");
    expect(within(card).getByText(providers.blurbs.openai)).toBeInTheDocument();
    expect(within(card).getByTestId("ai-provider-key-openai")).toHaveAttribute(
      "placeholder",
      providers.keyPlaceholder,
    );
    expect(screen.queryByTestId("ai-provider-status-openai")).not.toBeInTheDocument();

    await user.click(within(card).getByRole("button", { name: providers.getKey }));
    expect(shell.open).toHaveBeenCalledWith("https://platform.openai.com/api-keys");
  });

  it("saves a newly typed key", async () => {
    const user = userEvent.setup();
    const validateAndSave = vi.fn().mockResolvedValue(undefined);
    renderTab({
      openProviders: { openai: true },
      keys: { openai: "sk-new" },
      validateAndSave,
    });

    await user.click(screen.getByTestId("ai-provider-save-openai"));
    expect(validateAndSave).toHaveBeenCalledWith("openai");
  });

  it("hides the key behind a replace button once one is stored, and deletes it", async () => {
    const user = userEvent.setup();
    const deleteKey = vi.fn().mockResolvedValue(undefined);
    renderTab({
      openProviders: { openai: true },
      keys: { openai: "sk-saved" },
      savedKeys: { openai: "sk-saved" },
      deleteKey,
    });

    expect(screen.queryByTestId("ai-provider-key-openai")).not.toBeInTheDocument();
    await user.click(screen.getByTestId("ai-provider-replace-openai"));
    expect(screen.getByTestId("ai-provider-key-openai")).toBeInTheDocument();

    await user.click(screen.getByTestId("ai-provider-delete-openai"));
    expect(deleteKey).toHaveBeenCalledWith("openai");
  });

  it("closes the replace field again once the new key validates", async () => {
    const user = userEvent.setup();
    const { rerender } = renderTab({
      openProviders: { openai: true },
      keys: { openai: "sk-saved" },
      savedKeys: { openai: "sk-saved" },
    });

    await user.click(screen.getByTestId("ai-provider-replace-openai"));
    expect(screen.getByTestId("ai-provider-key-openai")).toBeInTheDocument();

    rerender({ status: { openai: "valid" } });
    await waitFor(() =>
      expect(screen.queryByTestId("ai-provider-key-openai")).not.toBeInTheDocument(),
    );
  });

  it("reports every validation state", () => {
    const { rerender } = renderTab({
      openProviders: { openai: true },
      status: { openai: "validating" },
    });
    expect(screen.getByTestId("ai-provider-status-openai")).toHaveTextContent(
      providers.status.validating,
    );

    rerender({ status: { openai: "valid" } });
    expect(screen.getByTestId("ai-provider-status-openai")).toHaveTextContent(
      providers.status.valid,
    );

    rerender({ status: { openai: "error" }, errorMsg: { openai: "401 unauthorized" } });
    expect(screen.getByTestId("ai-provider-status-openai")).toHaveTextContent(
      providers.status.error.replace("{{message}}", "401 unauthorized"),
    );

    rerender({ status: { openai: "error" } });
    expect(screen.getByTestId("ai-provider-status-openai")).toHaveTextContent(
      providers.status.error.replace("{{message}}", providers.status.errorFallback),
    );
  });

  it("offers the model picker and the model manager for the configured active provider", () => {
    renderTab({
      openProviders: { openai: true },
      savedKeys: { openai: "sk-saved" },
      keys: { openai: "sk-saved" },
      cfg: {
        ...cfg,
        ai_provider: "openai",
        ai_model: "gpt-4o-mini",
        ai_provider_models: {
          openai: [{ id: "gpt-4o-mini", name: "GPT-4o mini", enabled: true }],
        },
      } as unknown as AppConfig,
    });

    const card = screen.getByTestId("ai-provider-card-openai");
    expect(within(card).getAllByText(providers.modelLabel)[0]).toBeInTheDocument();
    expect(within(card).getByText(providers.badge.connected)).toBeInTheDocument();
  });
});

describe("ProvidersTab custom providers", () => {
  const custom = { id: "gateway", name: "Gateway", baseURL: "https://gw.test/v1" };
  const customCfg = {
    ...cfg,
    ai_custom_providers: [custom],
  } as unknown as AppConfig;

  it("edits a custom provider", async () => {
    const user = userEvent.setup();
    const onEditCustomProvider = vi.fn();
    renderTab({
      cfg: customCfg,
      openProviders: { gateway: true },
      onEditCustomProvider,
    });

    const card = screen.getByTestId("ai-provider-card-gateway");
    expect(within(card).getByText(providers.blurbs.custom)).toBeInTheDocument();
    await user.click(screen.getByTestId("ai-provider-edit-gateway"));
    expect(onEditCustomProvider).toHaveBeenCalledWith("gateway");
  });

  it("asks before removing a custom provider and honours both answers", async () => {
    const user = userEvent.setup();
    const deleteCustomProvider = vi.fn().mockResolvedValue(undefined);
    renderTab({
      cfg: customCfg,
      openProviders: { gateway: true },
      deleteCustomProvider,
    });

    await user.click(screen.getByTestId("ai-provider-delete-gateway"));
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText(providers.removeDialog.title)).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        providers.removeDialog.description.replace("{{provider}}", "Gateway"),
      ),
    ).toBeInTheDocument();

    await user.click(
      within(dialog).getByRole("button", { name: new RegExp(enCommon.actions.cancel) }),
    );
    expect(deleteCustomProvider).not.toHaveBeenCalled();

    await user.click(screen.getByTestId("ai-provider-delete-gateway"));
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: enCommon.actions.remove,
      }),
    );
    expect(deleteCustomProvider).toHaveBeenCalledWith("gateway");
  });
});

describe("ProvidersTab Ollama card", () => {
  it("has not checked the host yet when idle", async () => {
    const user = userEvent.setup();
    const refreshOllama = vi.fn().mockResolvedValue(undefined);
    renderTab({ openProviders: { ollama: true }, refreshOllama });

    const card = screen.getByTestId("ai-provider-card-ollama");
    expect(within(card).getByText(providers.ollama.notChecked)).toBeInTheDocument();
    await user.click(within(card).getByRole("button", { name: providers.ollama.check }));
    expect(refreshOllama).toHaveBeenCalledWith("http://127.0.0.1:11434");
  });

  it("shows the checking line while a probe is in flight", () => {
    renderTab({
      openProviders: { ollama: true },
      ollama: { status: "loading", models: [], installed: false, starting: false },
    });

    const card = screen.getByTestId("ai-provider-card-ollama");
    expect(within(card).getByText(providers.ollama.checking)).toBeInTheDocument();
    expect(
      within(card).getByRole("button", { name: providers.ollama.recheck }),
    ).toBeDisabled();
  });

  it("offers to start a host that is installed but not running", async () => {
    const user = userEvent.setup();
    const onStartOllama = vi.fn();
    renderTab({
      openProviders: { ollama: true },
      ollama: { status: "down", models: [], installed: true, starting: false },
      onStartOllama,
    });

    const card = screen.getByTestId("ai-provider-card-ollama");
    expect(within(card).getByText(providers.badge.notRunning)).toBeInTheDocument();
    expect(within(card).getByText(providers.ollama.installedHint)).toBeInTheDocument();
    await user.click(screen.getByTestId("ollama-start"));
    expect(onStartOllama).toHaveBeenCalled();
  });

  it("asks for a pull when the host answers with no models", () => {
    renderTab({
      openProviders: { ollama: true },
      ollama: { status: "ok", models: [], installed: true, starting: false },
    });

    const card = screen.getByTestId("ai-provider-card-ollama");
    expect(within(card).getByText(providers.badge.running)).toBeInTheDocument();
    expect(
      within(card).getByText(
        providers.ollama.runningModels_other.replace("{{count}}", "0"),
      ),
    ).toBeInTheDocument();
  });

  it("marks the running model active and offers to disconnect the saved host", async () => {
    const user = userEvent.setup();
    const deleteKey = vi.fn().mockResolvedValue(undefined);
    renderTab({
      openProviders: { ollama: true },
      keys: { ollama: "http://localhost:11434" },
      savedKeys: { ollama: "http://localhost:11434" },
      cfg: { ...cfg, ai_provider: "ollama", ai_model: "llama3.2" } as unknown as AppConfig,
      ollama: { status: "ok", models: ["llama3.2"], installed: true, starting: false },
      deleteKey,
    });

    const card = screen.getByTestId("ai-provider-card-ollama");
    expect(within(card).getByText(providers.ollama.active)).toBeInTheDocument();

    await user.click(
      within(card).getByRole("button", { name: providers.ollama.disconnect }),
    );
    expect(deleteKey).toHaveBeenCalledWith("ollama");
  });

  it("reveals and hides the host field", async () => {
    const user = userEvent.setup();
    const setKeys = vi.fn();
    renderTab({ openProviders: { ollama: true }, setKeys });

    const card = screen.getByTestId("ai-provider-card-ollama");
    await user.click(
      within(card).getByRole("button", { name: providers.ollama.changeHost }),
    );
    const host = within(card).getByPlaceholderText("http://127.0.0.1:11434");
    await user.type(host, "x");
    expect(setKeys).toHaveBeenCalled();

    await user.click(
      within(card).getByRole("button", { name: providers.ollama.hideHost }),
    );
    expect(
      within(card).queryByPlaceholderText("http://127.0.0.1:11434"),
    ).not.toBeInTheDocument();
  });
});

describe("ProvidersTab footer", () => {
  it("adds a custom provider from the footer button", async () => {
    const user = userEvent.setup();
    const onAddCustomProvider = vi.fn();
    renderTab({ onAddCustomProvider });

    await user.click(screen.getByTestId("ai-add-custom-provider"));
    expect(onAddCustomProvider).toHaveBeenCalled();
  });
});
