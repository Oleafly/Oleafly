// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "@/lib/tauri";

const mocks = vi.hoisted(() => ({
  getConfig: vi.fn(),
  setConfig: vi.fn(),
}));

vi.mock("@/lib/tauri", () => ({
  getConfig: mocks.getConfig,
  setConfig: mocks.setConfig,
}));

vi.mock("@/i18n/desktop", () => ({
  changeLocalePreference: vi.fn(async () => undefined),
}));

import {
  applySettingsPlan,
  buildSettingsDocument,
  captureSettingsSnapshot,
  readLocalSnapshot,
  readSettingsFile,
  serializeSettingsDocument,
} from "./transfer";

const THEME = { preference: "system" as const, setPreference: vi.fn() };

function baseConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    github_token: "",
    github_user: "",
    github_connected: false,
    ai_api_key: "secret-should-never-leave",
    ai_provider: "openai",
    ai_model: "gpt-4o-mini",
    ai_keys: { openai: "sk-never" },
    ai_system_prompt: "Be brief.",
    ai_pdf_capture: true,
    ai_provider_models: {},
    ai_custom_providers: [],
    ai_personas: [],
    ai_starter_personas_seeded: true,
    checkpoints_enabled: true,
    checkpoint_notifications: true,
    git_auto_init: true,
    mcp_enabled: false,
    mcp_port: 5323,
    mcp_read_only: false,
    mcp_approval_policy: "ask",
    mcp_servers: [],
    ...overrides,
  };
}

function fileWith(body: Record<string, unknown>): string {
  return JSON.stringify(body);
}

beforeEach(() => {
  localStorage.clear();
  mocks.getConfig.mockResolvedValue(baseConfig());
  mocks.setConfig.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("research task defaults in the settings file", () => {
  it("exports and imports the research defaults in the settings file", async () => {
    mocks.getConfig.mockResolvedValue(
      baseConfig({
        research_keep_awake: false,
        research_notifications: false,
        research_command_network: true,
        research_time_budget_minutes: 240,
        research_task_mcp_servers: ["lab-cluster-mcp"],
      }),
    );
    const captured = await captureSettingsSnapshot("system");
    const text = serializeSettingsDocument(buildSettingsDocument(captured));

    expect(JSON.parse(text).research).toEqual({
      keepAwake: false,
      notifications: false,
      commandNetwork: true,
      timeBudgetMinutes: 240,
    });
    // The MCP servers tasks may use belong to this computer and stay out of the file.
    expect(text).not.toContain("lab-cluster-mcp");
    expect(readSettingsFile(text, captured)).toMatchObject({ ok: true, changed: [], ignored: [] });

    const read = readSettingsFile(
      fileWith({ research: { keepAwake: true, notifications: false, commandNetwork: false, timeBudgetMinutes: 60 } }),
      captured,
    );
    if (!read.ok) throw new Error("expected a valid file");
    expect(read.changed).toEqual(["research.keepAwake", "research.commandNetwork", "research.timeBudgetMinutes"]);

    await applySettingsPlan(read.plan, THEME);

    expect(mocks.setConfig).toHaveBeenCalledTimes(1);
    expect(mocks.setConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        ai_api_key: "secret-should-never-leave",
        research_keep_awake: true,
        research_notifications: false,
        research_command_network: false,
        research_time_budget_minutes: 60,
        research_task_mcp_servers: ["lab-cluster-mcp"],
      }),
    );
  });

  it("exports the research defaults of a config saved before they existed", async () => {
    const captured = await captureSettingsSnapshot("system");

    expect(captured.config).toMatchObject({
      research_keep_awake: true,
      research_notifications: true,
      research_command_network: false,
      research_time_budget_minutes: 120,
    });
    expect(buildSettingsDocument(captured).research).toEqual({
      keepAwake: true,
      notifications: true,
      commandNetwork: false,
      timeBudgetMinutes: 120,
    });
  });

  it("refuses research values outside their schema and applies nothing", () => {
    const read = readSettingsFile(
      fileWith({ research: { keepAwake: "yes", notifications: 2, commandNetwork: "off", timeBudgetMinutes: 90 } }),
      readLocalSnapshot(null, "system"),
    );

    expect(read).toEqual({
      ok: false,
      reason: "invalid",
      problems: [
        { path: "research.keepAwake", issue: { kind: "boolean" } },
        { path: "research.notifications", issue: { kind: "boolean" } },
        { path: "research.timeBudgetMinutes", issue: { kind: "oneOf", values: [30, 60, 120, 240, 480, 720, 1440] } },
      ],
    });
  });

  it("reports an MCP server list in a file as a key it doesn't know", () => {
    const read = readSettingsFile(
      fileWith({ research: { timeBudgetMinutes: 480, taskMcpServers: ["lab-cluster-mcp"] } }),
      readLocalSnapshot(null, "system"),
    );

    expect(read).toMatchObject({
      ok: true,
      changed: ["research.timeBudgetMinutes"],
      ignored: ["research.taskMcpServers"],
    });
  });

  it("leaves the research defaults out when the config can't be read", () => {
    expect(buildSettingsDocument(readLocalSnapshot(null, "system")).research).toBeUndefined();
  });
});
