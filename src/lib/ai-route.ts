import { i18n } from "@/i18n";
import { acpError } from "@/lib/acp";
import { agentErrorKind, type ProviderOverride } from "@/lib/agent-backend";
import { hasConfiguredProvider } from "@/lib/ai-providers";
import { getConfig, type AppConfig } from "@/lib/tauri";

/** A CLI agent as a provider, such as `acp:claude`. */
export const CLI_AGENT_PREFIX = "acp:";

export interface CliAgentRoute {
  provider_id: string;
  model_id: string;
  agent: string;
}

/** The CLI agent saved as the model for Tools. AI features use it only when
 * no API provider is set up, so a user with a key sees no change. */
export function cliAgentRoute(
  cfg: Pick<AppConfig, "ai_tools_model" | "ai_keys" | "ai_custom_providers" | "ai_provider">,
): CliAgentRoute | null {
  if (hasConfiguredProvider(cfg as AppConfig)) return null;
  const saved = cfg.ai_tools_model;
  const provider = saved?.provider?.trim() ?? "";
  const model = saved?.model?.trim() ?? "";
  if (!provider.startsWith(CLI_AGENT_PREFIX) || provider === CLI_AGENT_PREFIX || !model) return null;
  return { provider_id: provider, model_id: model, agent: saved?.label || provider.slice(CLI_AGENT_PREFIX.length) };
}

export function routeOverride(route: CliAgentRoute | null): ProviderOverride | undefined {
  return route ? { provider_id: route.provider_id, model_id: route.model_id } : undefined;
}

export function aiFeaturesReady(cfg: AppConfig): boolean {
  return hasConfiguredProvider(cfg) || cliAgentRoute(cfg) !== null;
}

export async function currentCliAgentRoute(): Promise<CliAgentRoute | null> {
  try {
    return cliAgentRoute(await getConfig());
  } catch {
    return null;
  }
}

export interface CliAgentFailure {
  message: string;
  /** Whether the agent's own settings are where to fix it. */
  agentSettings: boolean;
}

/** What a CLI agent's failure means, in the app's words. Its message reads
 * `[kind] text`; any other failure stays as it is. */
export function cliAgentFailure(agent: string, model: string, error: unknown): CliAgentFailure | null {
  switch (agentErrorKind(error)) {
    case "auth":
      return { message: i18n.t(($) => $.researchTools.converterModel.errors.agentSignIn, { agent }), agentSettings: true };
    case "agent_unavailable":
      return { message: i18n.t(($) => $.researchTools.converterModel.errors.agentNotReady, { agent }), agentSettings: true };
    case "agent_images":
      return { message: i18n.t(($) => $.researchTools.converterModel.errors.cannotSeeImages, { model: agent }), agentSettings: false };
    case "agent_model":
      return {
        message: i18n.t(($) => $.researchTools.converterModel.errors.modelUnavailable, { model, provider: agent }),
        agentSettings: false,
      };
    case "agent_tool":
      return { message: i18n.t(($) => $.researchTools.converterModel.errors.agentUsedTool, { agent }), agentSettings: false };
    case "agent_read_only":
      return { message: i18n.t(($) => $.researchTools.converterModel.errors.agentNeedsReadOnly, { agent }), agentSettings: false };
    case "agent_too_large":
      return { message: i18n.t(($) => $.researchTools.converterModel.errors.agentTooLong, { agent }), agentSettings: false };
    case "agent":
      return {
        message: acpError(String((error as Error).message).replace(/^\[agent\]\s*/, "")),
        agentSettings: true,
      };
    default:
      return null;
  }
}

/** Runs `work` and rewords a CLI agent's failure. */
export async function withCliAgentErrors<T>(route: CliAgentRoute | null, work: () => Promise<T>): Promise<T> {
  if (!route) return work();
  try {
    return await work();
  } catch (error) {
    const failure = cliAgentFailure(route.agent, route.model_id, error);
    throw failure ? new Error(failure.message) : error;
  }
}
