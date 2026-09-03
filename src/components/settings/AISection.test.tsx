// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "@/lib/tauri";
import type { SkillEntry } from "@/lib/skills";
import { useFilesStore } from "@/store/files";
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
let skillsFixture: SkillEntry[] = [];
let configFixture: AppConfig;
let failSkillReset = false;

function configuredAiConfig(): AppConfig {
  return {
    github_token: "",
    github_user: "",
    github_connected: false,
    ai_api_key: "",
    ai_provider: "anthropic",
    ai_model: "claude-sonnet-4-6",
    ai_keys: {
      anthropic: "__stored__",
      ollama: "http://127.0.0.1:11434",
    },
    ai_system_prompt: "Use concise Canadian English.",
    ai_pdf_capture: false,
    ai_provider_models: {
      anthropic: [
        {
          id: "claude-opus-5",
          name: "Claude Opus 5",
          enabled: false,
          source: "builtin",
        },
        {
          id: "claude-haiku-4-5",
          name: "Claude Haiku 4.5",
          enabled: true,
          source: "builtin",
        },
        {
          id: "claude-sonnet-4-6",
          name: "Claude Sonnet 4.6",
          enabled: true,
          source: "builtin",
        },
        {
          id: "claude-retired-test",
          name: "Claude Retired Test",
          enabled: false,
          source: "builtin",
        },
        {
          id: "claude-live-preview",
          name: "Claude Live Preview",
          enabled: false,
          source: "fetched",
        },
      ],
      "local-lab": [
        {
          id: "research-model",
          name: "Research Model",
          enabled: false,
          source: "custom",
        },
      ],
    },
    ai_custom_providers: [
      {
        id: "local-lab",
        name: "Local Lab",
        baseURL: "http://127.0.0.1:9000/v1",
        keyOptional: true,
      },
    ],
    ai_personas: [
      {
        id: "reviewer",
        name: "Reviewer",
        color: "blue",
        prompt: "Review the argument before editing.",
      },
    ],
    ai_starter_personas_seeded: true,
    checkpoints_enabled: true,
    checkpoint_notifications: true,
    git_auto_init: true,
    mcp_enabled: true,
    mcp_port: 6123,
    mcp_read_only: true,
    mcp_approval_policy: "trust",
    mcp_servers: [
      {
        name: "research-notes",
        enabled: true,
        transport: "remote",
        url: "https://mcp.example.test",
        headers: { Authorization: "__stored__" },
      },
    ],
  };
}

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
    useFilesStore.setState({ projectId: null });
    skillsFixture = [];
    configFixture = configuredAiConfig();
    failSkillReset = false;
    mockInvoke.mockReset().mockImplementation(async (command, args) => {
      if (command === "get_config") {
        return configFixture;
      }
      if (command === "set_config") return undefined;
      if (command === "mcp_servers_list") return [];
      if (command === "skills_list") return skillsFixture;
      if (command === "skills_set_enabled") {
        if (failSkillReset) throw new Error("Skill reset failed");
        const skill = skillsFixture.find(
          (entry) => entry.id === (args as { id?: string } | undefined)?.id,
        );
        return skill
          ? {
              ...skill,
              enabled: (args as { enabled?: boolean } | undefined)?.enabled,
            }
          : undefined;
      }
      if (command === "budget_set_cmd") return undefined;
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

  it("resets only AI Assistant preferences after confirmation", async () => {
    const user = userEvent.setup();
    useSettingsStore.getState().setVisualEditor(true);
    useFilesStore.setState({ projectId: "project-ai-reset" });
    skillsFixture = [
      {
        id: "claim-checker",
        name: "Claim Checker",
        description: "Check claims against sources.",
        instructions: "Check every claim.",
        source: "user",
        enabled: true,
        removable: true,
        validation: { status: "valid" },
      },
      {
        id: "disabled-skill",
        name: "Disabled Skill",
        description: "Already disabled.",
        instructions: "Stay disabled.",
        source: "user",
        enabled: false,
        removable: true,
        validation: { status: "valid" },
      },
    ];
    renderSection();
    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith("get_config"),
    );

    await user.click(
      screen.getByRole("button", { name: "Reset to defaults" }),
    );
    const confirmation = screen.getByRole("alertdialog");
    expect(confirmation).toHaveTextContent(
      "including model availability, enabled skills, and this project's budget",
    );
    expect(confirmation).toHaveTextContent(
      "The active provider and model, provider keys, personas, approval rules, usage history, and MCP servers will stay unchanged.",
    );

    await user.click(
      within(confirmation).getByRole("button", { name: "Reset to defaults" }),
    );

    await waitFor(() => {
      const write = mockInvoke.mock.calls.find(
        ([command]) => command === "set_config",
      );
      expect(write).toBeDefined();
      if (!write) throw new Error("Expected AI settings to be persisted");
      const config = (write[1] as { config: AppConfig }).config;
      expect(config).toMatchObject({
        ai_provider: "anthropic",
        ai_model: "claude-sonnet-4-6",
        ai_system_prompt: "",
        ai_pdf_capture: true,
        ai_keys: {
          anthropic: "__stored__",
          ollama: "http://127.0.0.1:11434",
        },
        ai_custom_providers: [
          {
            id: "local-lab",
            name: "Local Lab",
            baseURL: "http://127.0.0.1:9000/v1",
            keyOptional: true,
          },
        ],
        ai_personas: [
          {
            id: "reviewer",
            name: "Reviewer",
            color: "blue",
            prompt: "Review the argument before editing.",
          },
        ],
        mcp_enabled: true,
        mcp_port: 6123,
        mcp_read_only: true,
        mcp_approval_policy: "trust",
        mcp_servers: [
          {
            name: "research-notes",
            enabled: true,
            transport: "remote",
            url: "https://mcp.example.test",
            headers: { Authorization: "__stored__" },
          },
        ],
      });
      expect(config.ai_provider_models).toEqual({
        anthropic: [
          {
            id: "claude-opus-5",
            name: "Claude Opus 5",
            enabled: true,
            source: "builtin",
          },
          {
            id: "claude-haiku-4-5",
            name: "Claude Haiku 4.5",
            enabled: true,
            source: "builtin",
          },
          {
            id: "claude-sonnet-4-6",
            name: "Claude Sonnet 4.6",
            enabled: true,
            source: "builtin",
          },
          {
            id: "claude-live-preview",
            name: "Claude Live Preview",
            enabled: true,
            source: "fetched",
          },
          {
            id: "claude-sonnet-5",
            name: "Claude Sonnet 5",
            enabled: true,
            source: "builtin",
          },
          {
            id: "claude-fable-5",
            name: "Claude Fable 5",
            enabled: true,
            source: "builtin",
          },
        ],
        "local-lab": [
          {
            id: "research-model",
            name: "Research Model",
            enabled: true,
            source: "custom",
          },
        ],
      });
    });
    expect(useSettingsStore.getState().visualEditor).toBe(true);
    expect(mockInvoke).toHaveBeenCalledWith("skills_set_enabled", {
      id: "claim-checker",
      enabled: false,
    });
    expect(
      mockInvoke.mock.calls.filter(
        ([command]) => command === "skills_set_enabled",
      ),
    ).toHaveLength(1);
    expect(mockInvoke).toHaveBeenCalledWith("budget_set_cmd", {
      projectId: "project-ai-reset",
      budgetUsd: null,
    });
    expect(
      await screen.findByText(
        "AI Assistant preferences restored to their defaults.",
      ),
    ).toBeInTheDocument();
  });

  it("keeps reset disabled until the persisted AI configuration loads", async () => {
    let resolveConfig: ((config: AppConfig) => void) | undefined;
    const pendingConfig = new Promise<AppConfig>((resolve) => {
      resolveConfig = resolve;
    });
    mockInvoke.mockImplementation(async (command) => {
      if (command === "get_config") return pendingConfig;
      if (command === "mcp_servers_list") return [];
      if (command === "set_config") return undefined;
      throw new Error(`Unexpected command: ${command}`);
    });

    renderSection();

    const reset = screen.getByRole("button", { name: "Reset to defaults" });
    expect(reset).toBeDisabled();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(
      mockInvoke.mock.calls.filter(([command]) => command === "set_config"),
    ).toHaveLength(0);

    resolveConfig?.(configuredAiConfig());
    await waitFor(() => expect(reset).toBeEnabled());
  });

  it("keeps the PDF runtime mirror consistent when a skill reset fails", async () => {
    const user = userEvent.setup();
    useFilesStore.setState({ projectId: "project-ai-reset-failure" });
    skillsFixture = [
      {
        id: "failing-skill",
        name: "Failing Skill",
        description: "Fails while resetting.",
        instructions: "Fail.",
        source: "user",
        enabled: true,
        removable: true,
        validation: { status: "valid" },
      },
    ];
    failSkillReset = true;
    localStorage.setItem("oleafly:ai_pdf_capture", "0");
    renderSection();
    const reset = screen.getByRole("button", { name: "Reset to defaults" });
    await waitFor(() => expect(reset).toBeEnabled());

    await user.click(reset);
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Reset to defaults",
      }),
    );

    expect(await screen.findByText(/Skill reset failed/u)).toBeInTheDocument();
    expect(localStorage.getItem("oleafly:ai_pdf_capture")).toBe("1");
    expect(
      mockInvoke.mock.calls.filter(([command]) => command === "budget_set_cmd"),
    ).toHaveLength(0);
  });

  it("preserves a legacy active model when model preferences have no record", async () => {
    const user = userEvent.setup();
    configFixture = {
      ...configuredAiConfig(),
      ai_model: "claude-3-5-haiku-20241022",
      ai_provider_models: {},
    };
    renderSection();
    const reset = screen.getByRole("button", { name: "Reset to defaults" });
    await waitFor(() => expect(reset).toBeEnabled());

    await user.click(reset);
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Reset to defaults",
      }),
    );

    await waitFor(() => {
      const write = mockInvoke.mock.calls.find(
        ([command]) => command === "set_config",
      );
      expect(write).toBeDefined();
      if (!write) throw new Error("Expected AI settings to be persisted");
      expect((write[1] as { config: AppConfig }).config.ai_model).toBe(
        "claude-3-5-haiku-20241022",
      );
    });
  });
});
