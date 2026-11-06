import { describe, expect, it } from "vitest";
import researchTools from "@/i18n/locales/en/researchTools.json" with { type: "json" };
import type { AppConfig } from "@/lib/tauri";
import { aiFeaturesReady, cliAgentFailure, cliAgentRoute, routeOverride, withCliAgentErrors } from "./ai-route";

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

const claude = { ai_tools_model: { provider: "acp:claude", model: "opus", label: "Claude Code" } };
const errors = researchTools.converterModel.errors;

describe("the CLI agent route for AI features", () => {
  it("uses the CLI agent picked for Tools when no API provider is set up", () => {
    expect(cliAgentRoute(config(claude))).toEqual({ provider_id: "acp:claude", model_id: "opus", agent: "Claude Code" });
    expect(aiFeaturesReady(config(claude))).toBe(true);
  });

  it("leaves anyone with an API provider on that provider", () => {
    const keyed = config({ ...claude, ai_provider: "groq", ai_keys: { groq: "gsk_test" } });
    expect(cliAgentRoute(keyed)).toBeNull();
    expect(aiFeaturesReady(keyed)).toBe(true);
  });

  it("needs a CLI agent, not an Ollama or hosted Tools model", () => {
    expect(cliAgentRoute(config({ ai_tools_model: { provider: "ollama", model: "llava" } }))).toBeNull();
    expect(cliAgentRoute(config({ ai_tools_model: { provider: "acp:", model: "default" } }))).toBeNull();
    expect(cliAgentRoute(config())).toBeNull();
    expect(aiFeaturesReady(config())).toBe(false);
  });

  it("names the agent by its id when no name was saved", () => {
    expect(cliAgentRoute(config({ ai_tools_model: { provider: "acp:codex", model: "default" } }))?.agent).toBe("codex");
  });

  it("turns into a provider override with nothing else in it", () => {
    expect(routeOverride(cliAgentRoute(config(claude)))).toEqual({ provider_id: "acp:claude", model_id: "opus" });
    expect(routeOverride(null)).toBeUndefined();
  });
});

describe("a CLI agent's failures", () => {
  it.each([
    ["[auth] x", errors.agentSignIn.replace("{{agent}}", "Claude Code"), true],
    ["[agent_unavailable] x", errors.agentNotReady.replace("{{agent}}", "Claude Code"), true],
    ["[agent_tool] x", errors.agentUsedTool.replace("{{agent}}", "Claude Code"), false],
    ["[agent_read_only] x", errors.agentNeedsReadOnly.replace("{{agent}}", "Claude Code"), false],
    ["[agent_too_large] x", errors.agentTooLong.replace("{{agent}}", "Claude Code"), false],
    ["[agent] You have hit your usage limit.", "You have hit your usage limit.", true],
  ])("reads %s", (raw, message, agentSettings) => {
    expect(cliAgentFailure("Claude Code", "opus", new Error(raw))).toEqual({ message, agentSettings });
  });

  it("leaves other failures alone", async () => {
    expect(cliAgentFailure("Claude Code", "opus", new Error("[provider] 500"))).toBeNull();
    const route = cliAgentRoute(config(claude));
    const failure = new Error("[cancelled] stopped");
    await expect(withCliAgentErrors(route, () => Promise.reject(failure))).rejects.toBe(failure);
    await expect(withCliAgentErrors(null, () => Promise.reject(new Error("[auth] x")))).rejects.toThrow("[auth] x");
  });
});
