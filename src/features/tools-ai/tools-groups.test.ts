import { describe, expect, it } from "vitest";
import researchTools from "@/i18n/locales/en/researchTools.json" with { type: "json" };
import type { AcpAgentStatus } from "@/lib/acp";
import type { AppConfig, ModelMetadata, StoredModel } from "@/lib/tauri";
import { toolsModelGroups } from "./tools-groups";

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

function stored(id: string, enabled = true, metadata?: ModelMetadata): StoredModel {
  return { id, name: id, enabled, source: "fetched", ...(metadata ? { metadata } : {}) };
}

const visionMetadata: ModelMetadata = {
  name: "Vision",
  inputModalities: ["text", "image"],
  outputModalities: ["text"],
  toolCall: true,
  reasoning: false,
  attachment: true,
  structuredOutput: false,
  status: "active",
};

describe("Tools model picker groups", () => {
  it("puts Automatic first in the Local group and lists only vision models that are not turned off", () => {
    const groups = toolsModelGroups(
      config({ ai_provider_models: { ollama: [stored("llava", false)] } }),
      [
        { name: "glm-ocr", capabilities: ["completion", "vision"] },
        { name: "llama3.2", capabilities: ["completion", "tools"] },
        { name: "llava", capabilities: null },
      ],
      false,
    );
    expect(groups[0]).toMatchObject({ id: "ollama", name: researchTools.converterModel.localGroup });
    expect(groups[0].models.map((model) => model.id)).toEqual(["", "glm-ocr"]);
    expect(groups[0].models[0].name).toBe(researchTools.converterModel.automatic);
  });

  it("lists vision models from configured hosted providers with their metadata, never Ollama twice", () => {
    const groups = toolsModelGroups(
      config({
        ai_keys: { ollama: "http://127.0.0.1:11434", anthropic: "__stored__", groq: "__stored__", openai: "" },
        ai_provider_models: {
          ollama: [stored("llava")],
          anthropic: [stored("claude-opus-5-5", true, visionMetadata), stored("claude-haiku-5-5", false)],
          groq: [stored("openai/gpt-oss-120b")],
        },
      }),
      [{ name: "llava", capabilities: ["vision"] }],
      false,
    );
    expect(groups.map((group) => group.id)).toEqual(["ollama", "anthropic"]);
    expect(groups.filter((group) => group.id === "ollama")).toHaveLength(1);
    expect(groups[1].models).toEqual([
      { id: "claude-opus-5-5", name: "Claude Opus 5.5", metadata: visionMetadata },
    ]);
  });

  it("adds Mathpix only when its keys are saved", () => {
    expect(toolsModelGroups(config(), [], false).map((group) => group.id)).toEqual(["ollama"]);
    const groups = toolsModelGroups(config(), [], true);
    expect(groups.at(-1)).toEqual({
      id: "mathpix",
      name: "Mathpix",
      models: [{ id: "mathpix", name: researchTools.converterModel.mathpixModel }],
    });
  });

  it("keeps Ollama Cloud models out of the Local group", () => {
    const groups = toolsModelGroups(
      config(),
      [
        { name: "qwen3-vl:235b-cloud", capabilities: ["completion", "vision"], remote: true },
        { name: "minimax-m2:cloud", capabilities: ["completion", "vision"] },
        { name: "qwen2.5vl:7b", capabilities: ["completion", "vision"], remote: false },
      ],
      false,
    );
    expect(groups[0].models.map((model) => model.id)).toEqual(["", "qwen2.5vl:7b"]);
  });

  it("an unreachable Ollama leaves only Automatic", () => {
    const groups = toolsModelGroups(config({ ai_keys: { ollama: "http://127.0.0.1:11434" } }), null, false);
    expect(groups).toHaveLength(1);
    expect(groups[0].models.map((model) => model.id)).toEqual([""]);
  });
});

describe("CLI agents in the picker", () => {
  function agent(id: string, name: string, overrides: Partial<AcpAgentStatus> = {}): AcpAgentStatus {
    return {
      definition: { id, name, version: "1.0.0", description: "", builtin: true, distribution: {} },
      platform: "darwin-aarch64",
      installed: true,
      executable: `/bin/${id}`,
      installedVersion: "1.0.0",
      managed: true,
      canInstall: true,
      reason: null,
      signInHint: null,
      taskUnavailableReason: null,
      cli: null,
      bridgeSharedWithCli: false,
      ...overrides,
    };
  }

  function runtime(models: { modelId: string; name: string }[] | null, image: boolean | null = true) {
    return {
      protocol: 1,
      protocolLabel: "ACP v1",
      providers: false,
      providersSupported: [],
      steering: false,
      sessionList: false,
      sessionFork: false,
      sessionDelete: false,
      logout: false,
      authMethods: [],
      checkedAt: 1,
      image,
      models,
    };
  }

  const agents = (groups: ReturnType<typeof toolsModelGroups>) => groups.filter((group) => group.id.startsWith("acp:"));

  it("lists a connected agent with no API key anywhere", () => {
    const groups = toolsModelGroups(config(), null, false, [
      agent("claude", "Claude Code", {
        runtime: runtime([
          { modelId: "default", name: "Default (recommended)" },
          { modelId: "opus", name: "Opus" },
        ]),
      }),
    ]);
    expect(agents(groups)).toEqual([
      {
        id: "acp:claude",
        name: "Claude Code",
        models: [
          { id: "default", name: "Default (recommended)" },
          { id: "opus", name: "Opus" },
        ],
      },
    ]);
  });

  it("offers the agent's own default until it has listed its models", () => {
    const groups = toolsModelGroups(config(), null, false, [agent("codex", "Codex CLI", { runtime: runtime(null, null) })]);
    expect(agents(groups)[0].models).toEqual([
      { id: "default", name: researchTools.converterModel.agentDefaultModel },
    ]);
  });

  it("adds the default next to models that don't name one", () => {
    const groups = toolsModelGroups(config(), null, false, [
      agent("codex", "Codex CLI", { runtime: runtime([{ modelId: "gpt-6-luna", name: "Luna" }]) }),
    ]);
    expect(agents(groups)[0].models.map((model) => model.id)).toEqual(["default", "gpt-6-luna"]);
  });

  it("leaves out agents that aren't set up, can't read images or can't be held to reading", () => {
    const groups = toolsModelGroups(config(), null, false, [
      agent("gemini", "Gemini CLI", { installed: false, executable: null }),
      agent("pi", "Pi", { runtime: runtime([], false) }),
      agent("hermes", "Hermes", { runtime: { ...runtime([], true), readOnly: false } }),
    ]);
    expect(agents(groups)).toEqual([]);
  });

  it("lists an agent while it is still unknown whether it has a read-only mode", () => {
    const groups = toolsModelGroups(config(), null, false, [
      agent("codex", "Codex CLI", { runtime: { ...runtime(null, null), readOnly: null } }),
    ]);
    expect(agents(groups).map((group) => group.id)).toEqual(["acp:codex"]);
  });

  it("keeps agents after the hosted providers", () => {
    const groups = toolsModelGroups(
      config({
        ai_keys: { anthropic: "__stored__" },
        ai_provider_models: { anthropic: [stored("claude-opus-5-5", true, visionMetadata)] },
      }),
      null,
      false,
      [agent("claude", "Claude Code")],
    );
    expect(groups.map((group) => group.id)).toEqual(["ollama", "anthropic", "acp:claude"]);
  });
});
