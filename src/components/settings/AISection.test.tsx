// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppConfig, ProviderModel } from "@/lib/tauri";
import type { SkillEntry } from "@/lib/skills";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";
import type { AddCustomProviderDialogProps } from "./ai/AddCustomProviderDialog";
import type { ProvidersTabProps } from "./ai/ProvidersTab";
import { AISection } from "./AISection";

const captured = vi.hoisted(() => ({
  providersTab: null as ProvidersTabProps | null,
  dialog: null as AddCustomProviderDialogProps | null,
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@/lib/ollama", () => ({
  DEFAULT_OLLAMA_HOST: "http://127.0.0.1:11434",
  listOllamaModels: vi.fn().mockResolvedValue([]),
  ollamaInstalled: vi.fn().mockResolvedValue(false),
  startOllama: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("./ai/ProvidersTab", () => ({
  ProvidersTab: (props: ProvidersTabProps) => {
    captured.providersTab = props;
    return <div>Provider settings</div>;
  },
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
vi.mock("./ai/AddCustomProviderDialog", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./ai/AddCustomProviderDialog")>()),
  AddCustomProviderDialog: (props: AddCustomProviderDialogProps) => {
    captured.dialog = props;
    return null;
  },
}));

const mockInvoke = vi.mocked(invoke);
let skillsFixture: SkillEntry[] = [];
let configFixture: AppConfig;
let failSkillReset = false;
let listedModels: ProviderModel[] = [];

function lastConfigWrite(): AppConfig {
  const writes = mockInvoke.mock.calls.filter(([command]) => command === "set_config");
  const write = writes[writes.length - 1];
  if (!write) throw new Error("Expected AI settings to be persisted");
  return (write[1] as { config: AppConfig }).config;
}

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

function resetHarness() {
  useSettingsStore.setState({ settingsScrollTarget: null });
  useFilesStore.setState({ projectId: null });
  skillsFixture = [];
  configFixture = configuredAiConfig();
  failSkillReset = false;
  listedModels = [];
  captured.providersTab = null;
  captured.dialog = null;
  mockInvoke.mockReset().mockImplementation(async (command, args) => {
    if (command === "get_config") {
      return configFixture;
    }
    if (command === "set_config") return undefined;
    if (command === "agent_list_models") return listedModels;
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
    if (command === "skills_set_project_enabled") {
      const input = args as { id?: string; enabled?: boolean } | undefined;
      const skill = skillsFixture.find((entry) => entry.id === input?.id);
      return skill ? { ...skill, projectEnabled: input?.enabled } : undefined;
    }
    if (command === "budget_set_cmd") return undefined;
    throw new Error(`Unexpected command: ${command}`);
  });
}

describe("AISection", () => {
  beforeEach(() => {
    resetHarness();
  });

  it("clears per-project skill enablement for the open project on reset", async () => {
    const user = userEvent.setup();
    useFilesStore.setState({ projectId: "proj-1" });
    skillsFixture = [
      {
        id: "peer-review",
        name: "Peer Review",
        description: "Review a manuscript.",
        instructions: "Read it closely.",
        dir: "/skills/peer-review",
        files: [],
        allowedTools: [],
        tier: "user",
        tools: [],
        updateAvailable: false,
        projectEnabled: true,
        source: "user",
        enabled: false,
        removable: true,
        validation: { status: "valid" },
      },
    ];
    renderSection();
    await waitFor(() =>
      expect(mockInvoke.mock.calls.some(([command]) => command === "get_config")).toBe(true),
    );

    await user.click(screen.getByRole("button", { name: "Reset to defaults" }));
    const confirmation = await screen.findByRole("alertdialog");
    await user.click(
      within(confirmation).getByRole("button", { name: "Reset to defaults" }),
    );

    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith("skills_set_project_enabled", {
        projectId: "proj-1",
        id: "peer-review",
        enabled: false,
      }),
    );
    expect(mockInvoke).toHaveBeenCalledWith("skills_list", { projectId: "proj-1" });
    expect(mockInvoke).not.toHaveBeenCalledWith("skills_set_enabled", {
      id: "peer-review",
      enabled: false,
    });
  });

  it("keeps a config field another panel changed while the section stayed open", async () => {
    const user = userEvent.setup();
    configFixture = { ...configuredAiConfig(), skills_share_with_agents: true };
    renderSection();
    await waitFor(() =>
      expect(
        mockInvoke.mock.calls.some(([command]) => command === "get_config"),
      ).toBe(true),
    );

    configFixture = { ...configFixture, skills_share_with_agents: false };

    await user.click(screen.getByRole("button", { name: "Reset to defaults" }));
    const confirmation = await screen.findByRole("alertdialog");
    await user.click(within(confirmation).getByRole("button", { name: "Reset to defaults" }));

    await waitFor(() => expect(lastConfigWrite().ai_system_prompt).toBe(""));
    expect(lastConfigWrite().skills_share_with_agents).toBe(false);
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
    expect(within(tabList).getAllByRole("tab")).toHaveLength(6);
    expect(within(tabList).getByRole("tab", { name: "CLI agents" })).toBeInTheDocument();
    await user.click(mcpTab);

    expect(
      await screen.findByRole("heading", { name: "Assistant MCP servers" }),
    ).toBeInTheDocument();
    expect(
      mockInvoke.mock.calls.filter(([command]) => command === "mcp_servers_list"),
    ).toHaveLength(1);

    await user.click(providersTab);
    await user.click(mcpTab);
    await screen.findByText("No servers added");
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
        dir: "/skills/claim-checker",
        files: [],
        allowedTools: [],
        tier: "user",
        tools: [],
        updateAvailable: false,
        projectEnabled: false,
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
        dir: "/skills/disabled-skill",
        files: [],
        allowedTools: [],
        tier: "user",
        tools: [],
        updateAvailable: false,
        projectEnabled: false,
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
        dir: "/skills/failing-skill",
        files: [],
        allowedTools: [],
        tier: "user",
        tools: [],
        updateAvailable: false,
        projectEnabled: false,
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

describe("AISection custom provider editing", () => {
  beforeEach(() => {
    resetHarness();
  });

  async function openEditor(id: string) {
    renderSection();
    await waitFor(() => expect(captured.providersTab).not.toBeNull());
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Reset to defaults" })).toBeEnabled(),
    );
    act(() => captured.providersTab?.onEditCustomProvider(id));
    await waitFor(() => expect(captured.dialog?.editing?.id).toBe(id));
  }

  it("prefills the editor and refreshes the model list after a base URL change", async () => {
    listedModels = [
      { id: "research-model-2", name: "Research Model 2", trust: "untested" },
    ];
    await openEditor("local-lab");

    expect(captured.dialog?.editing).toEqual({
      id: "local-lab",
      name: "Local Lab",
      baseURL: "http://127.0.0.1:9000/v1",
      hasStoredKey: false,
    });

    let result: { ok: boolean; message?: string } | undefined;
    await act(async () => {
      result = await captured.dialog?.onSubmit({
        id: "local-lab",
        name: "Lab",
        baseURL: "http://127.0.0.1:9100/v1/",
        apiKey: "",
      });
    });

    expect(result).toEqual({ ok: true });
    expect(mockInvoke).toHaveBeenCalledWith("agent_list_models", {
      providerId: "local-lab",
      key: null,
      baseUrl: "http://127.0.0.1:9100/v1",
    });
    const written = lastConfigWrite();
    expect(written.ai_custom_providers).toEqual([
      { id: "local-lab", name: "Lab", baseURL: "http://127.0.0.1:9100/v1", keyOptional: true },
    ]);
    expect(written.ai_provider_models["local-lab"].map((m) => m.id)).toEqual([
      "research-model",
      "research-model-2",
    ]);
    expect(written.ai_provider_models["local-lab"][1].trust).toBe("untested");
    expect(typeof written.ai_model_lists_refreshed_at?.["local-lab"]).toBe("number");
    expect(screen.getByText("Lab updated.")).toBeInTheDocument();
  });

  it("refuses a base URL change without the key when one is stored", async () => {
    configFixture = {
      ...configuredAiConfig(),
      ai_keys: { ...configuredAiConfig().ai_keys, "local-lab": "__stored__" },
    };
    await openEditor("local-lab");
    expect(captured.dialog?.editing?.hasStoredKey).toBe(true);

    let result: { ok: boolean; message?: string } | undefined;
    await act(async () => {
      result = await captured.dialog?.onSubmit({
        id: "local-lab",
        name: "Local Lab",
        baseURL: "http://127.0.0.1:9100/v1",
        apiKey: "",
      });
    });

    expect(result).toEqual({
      ok: false,
      message: "Enter the API key again to change the base URL.",
    });
    expect(mockInvoke).not.toHaveBeenCalledWith("agent_list_models", expect.anything());
  });

  it("keeps the saved base URL out of the listing call when only the name changes", async () => {
    configFixture = {
      ...configuredAiConfig(),
      ai_keys: { ...configuredAiConfig().ai_keys, "local-lab": "__stored__" },
    };
    await openEditor("local-lab");

    await act(async () => {
      await captured.dialog?.onSubmit({
        id: "local-lab",
        name: "Renamed Lab",
        baseURL: "http://127.0.0.1:9000/v1",
        apiKey: "",
      });
    });

    expect(mockInvoke).toHaveBeenCalledWith("agent_list_models", {
      providerId: "local-lab",
      key: null,
      baseUrl: null,
    });
    expect(lastConfigWrite().ai_custom_providers[0].name).toBe("Renamed Lab");
  });

  it("reports a re-entered key the backend did not keep after a base URL change", async () => {
    configFixture = {
      ...configuredAiConfig(),
      ai_keys: { ...configuredAiConfig().ai_keys, "local-lab": "__stored__" },
    };
    await openEditor("local-lab");
    const harness = mockInvoke.getMockImplementation();
    mockInvoke.mockImplementation(async (command, args) => {
      if (command === "get_config") {
        const kept = { ...configFixture.ai_keys };
        delete kept["local-lab"];
        return { ...configFixture, ai_keys: kept };
      }
      return harness?.(command, args);
    });

    let result: { ok: boolean; message?: string } | undefined;
    await act(async () => {
      result = await captured.dialog?.onSubmit({
        id: "local-lab",
        name: "Local Lab",
        baseURL: "http://127.0.0.1:9100/v1",
        apiKey: "sk-again",
      });
    });

    expect(result).toEqual({
      ok: false,
      message: "The base URL was saved but the key was not. Enter the key again.",
    });
    expect(lastConfigWrite().ai_keys["local-lab"]).toBe("sk-again");
    await waitFor(() => expect(captured.providersTab?.savedKeys["local-lab"]).toBeUndefined());
    expect(captured.providersTab?.cfg.ai_keys["local-lab"]).toBeUndefined();
    expect(captured.providersTab?.cfg.ai_custom_providers[0].baseURL).toBe(
      "http://127.0.0.1:9100/v1",
    );
    expect(screen.queryByText("Local Lab updated.")).not.toBeInTheDocument();
  });

  it("keeps a re-entered key the backend kept", async () => {
    configFixture = {
      ...configuredAiConfig(),
      ai_keys: { ...configuredAiConfig().ai_keys, "local-lab": "__stored__" },
    };
    await openEditor("local-lab");

    let result: { ok: boolean; message?: string } | undefined;
    await act(async () => {
      result = await captured.dialog?.onSubmit({
        id: "local-lab",
        name: "Local Lab",
        baseURL: "http://127.0.0.1:9100/v1",
        apiKey: "sk-again",
      });
    });

    expect(result).toEqual({ ok: true });
    await waitFor(() => expect(captured.providersTab?.savedKeys["local-lab"]).toBe("sk-again"));
    expect(screen.getByText("Local Lab updated.")).toBeInTheDocument();
  });

  it("stamps the refresh time and keeps trust when a key is saved", async () => {
    listedModels = [
      { id: "gpt-4o-mini", name: "GPT-4o mini", trust: "verified" },
      { id: "gpt-next", name: "GPT Next", trust: "untested" },
    ];
    renderSection();
    await waitFor(() => expect(captured.providersTab).not.toBeNull());
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Reset to defaults" })).toBeEnabled(),
    );

    act(() => captured.providersTab?.setKeys((keys) => ({ ...keys, openai: "sk-new" })));
    await waitFor(() => expect(captured.providersTab?.keys.openai).toBe("sk-new"));
    await act(async () => {
      await captured.providersTab?.validateAndSave("openai");
    });

    const written = lastConfigWrite();
    expect(typeof written.ai_model_lists_refreshed_at?.openai).toBe("number");
    const openai = written.ai_provider_models.openai;
    expect(openai.find((m) => m.id === "gpt-next")?.trust).toBe("untested");
    expect(openai.find((m) => m.id === "gpt-4o-mini")?.trust).toBe("verified");
  });
});
