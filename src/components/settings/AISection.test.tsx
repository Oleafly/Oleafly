// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "@/lib/tauri";
import { useSettingsStore } from "@/store/settings";
import { AISection } from "./AISection";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@/lib/ollama", () => ({
  DEFAULT_OLLAMA_HOST: "http://127.0.0.1:11434",
  listOllamaModels: vi.fn().mockResolvedValue([]),
}));
vi.mock("./ai/ProvidersTab", () => ({
  ProvidersTab: () => <div>Provider settings</div>,
}));
vi.mock("./ai/ProjectApprovals", () => ({
  ProjectApprovals: () => null,
}));
vi.mock("./ai/ProjectBudget", () => ({
  ProjectBudget: () => null,
}));
vi.mock("./ai/InstructionsTab", () => ({
  InstructionsTab: () => <div>Instruction settings</div>,
}));
vi.mock("./ai/PersonasTab", () => ({
  PersonasTab: () => <div>Persona settings</div>,
}));
vi.mock("./ai/SkillsTab", () => ({
  SkillsTab: () => <div>Skill settings</div>,
}));
vi.mock("./ai/AddCustomProviderDialog", () => ({
  AddCustomProviderDialog: () => null,
}));

const mockInvoke = vi.mocked(invoke);

function renderSection() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <AISection />
    </QueryClientProvider>,
  );
}

describe("AISection", () => {
  beforeEach(() => {
    useSettingsStore.setState({ settingsScrollTarget: null });
    mockInvoke.mockReset().mockImplementation(async (command) => {
      if (command === "get_config") {
        return {
          ai_provider: "openai",
          ai_model: "gpt-4o-mini",
          ai_keys: {},
          ai_provider_models: {},
          ai_custom_providers: [],
          ai_personas: [],
          mcp_servers: [],
        } as unknown as AppConfig;
      }
      if (command === "mcp_servers_list") return [];
      throw new Error(`Unexpected command: ${command}`);
    });
  });

  it("shows assistant servers on a fit-content MCP tab and retains manager state", async () => {
    const user = userEvent.setup();
    renderSection();

    const providersTab = screen.getByRole("tab", { name: "Providers and keys" });
    const tabList = providersTab.closest('[role="tablist"]');
    if (!(tabList instanceof HTMLElement)) throw new Error("AI settings tab list missing");
    expect(tabList).toHaveClass(
      "w-fit",
      "max-w-full",
      "overflow-x-auto",
      "no-scrollbar",
    );
    expect(tabList).not.toHaveClass("w-full");

    const mcpTab = screen.getByRole("tab", { name: "MCP" });
    expect(within(tabList).getAllByRole("tab")).toHaveLength(5);
    await user.click(mcpTab);

    expect(
      await screen.findByRole("heading", { name: "Assistant MCP servers" }),
    ).toBeInTheDocument();
    expect(
      mockInvoke.mock.calls.filter(([command]) => command === "mcp_servers_list"),
    ).toHaveLength(1);

    await user.click(providersTab);
    await user.click(mcpTab);
    await screen.findByText("No servers added.");
    expect(
      mockInvoke.mock.calls.filter(([command]) => command === "mcp_servers_list"),
    ).toHaveLength(1);
  });

  it("opens the MCP tab from its one-shot settings target", async () => {
    useSettingsStore.setState({ settingsScrollTarget: "ai-mcp" });
    renderSection();

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "MCP" })).toHaveAttribute(
        "aria-selected",
        "true",
      );
    });
    expect(
      await screen.findByRole("heading", { name: "Assistant MCP servers" }),
    ).toBeInTheDocument();
    expect(useSettingsStore.getState().settingsScrollTarget).toBeNull();
  });
});
