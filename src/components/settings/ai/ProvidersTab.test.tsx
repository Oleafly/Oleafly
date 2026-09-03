// @vitest-environment jsdom

import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AppConfig } from "@/lib/tauri";
import { agentModelMetadataStatus } from "@/lib/tauri";
import { createAppQueryClient } from "@/lib/query";
import { ProvidersTab, type ProvidersTabProps } from "./ProvidersTab";

vi.mock("@tauri-apps/plugin-shell", () => ({ open: vi.fn() }));
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

function renderTab() {
  const props: ProvidersTabProps = {
    cfg,
    keys: {},
    savedKeys: {},
    saving: null,
    openProviders: {},
    setOpenProviders: vi.fn(),
    setKeys: vi.fn(),
    ollama: { status: "idle", models: [] },
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
  };
  render(
    <QueryClientProvider client={createAppQueryClient()}>
      <ProvidersTab {...props} />
    </QueryClientProvider>,
  );
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
});
