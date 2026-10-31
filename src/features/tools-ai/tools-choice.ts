import {
  effectiveProviderKeys,
  getProvider,
  hasConfiguredProvider,
  isProviderConfigured,
  modelSupportsVision,
} from "@oleafly/ai-core";
import { i18n } from "@/i18n";
import { DEFAULT_OLLAMA_HOST, type OllamaModelInfo } from "@/lib/ollama";
import type { AppConfig, ModelMetadata, ToolsModelChoice } from "@/lib/tauri";
import { ocrProfileFor } from "./ocr-profiles";

export const LOCAL_TOOLS_PROVIDER = "ollama";
export const MATHPIX_TOOLS_PROVIDER = "mathpix";
export const MATHPIX_TOOLS_MODEL = "mathpix";
const MATHPIX_NAME = "Mathpix";

export function toolsChoice(cfg: Pick<AppConfig, "ai_tools_model">): ToolsModelChoice | null {
  const saved = cfg.ai_tools_model;
  const provider = saved?.provider?.trim() ?? "";
  const model = saved?.model?.trim() ?? "";
  if (!provider) return null;
  if (provider === LOCAL_TOOLS_PROVIDER && !model) return null;
  return { provider, model };
}

export function choiceFromSelection(providerId: string, modelId: string): ToolsModelChoice | null {
  return toolsChoice({ ai_tools_model: { provider: providerId, model: modelId } });
}

export function visionCapable(providerId: string, modelId: string, metadata?: ModelMetadata): boolean {
  return (
    modelSupportsVision(providerId, modelId, metadata?.inputModalities) || ocrProfileFor(modelId) !== null
  );
}

export function ollamaModelSeesImages(info: OllamaModelInfo): boolean {
  if (info.capabilities) return info.capabilities.includes("vision");
  return visionCapable(LOCAL_TOOLS_PROVIDER, info.name);
}

export const OLLAMA_CLOUD_NAME = "Ollama Cloud";

/** Whether an Ollama model runs on Ollama's servers rather than here:
 * Ollama says so, or the model's tag does ("qwen3-vl:235b-cloud",
 * "minimax-m2:cloud"). */
export function ollamaModelIsRemote(info: Pick<OllamaModelInfo, "name" | "remote">): boolean {
  if (info.remote) return true;
  const name = info.name.trim().toLowerCase();
  const colon = name.lastIndexOf(":");
  const base = colon >= 0 ? name.slice(0, colon) : name;
  const tag = colon >= 0 ? name.slice(colon + 1) : "";
  return tag === "cloud" || tag.endsWith("-cloud") || base.endsWith("-cloud");
}

export function disabledModels(cfg: AppConfig, providerId: string): ReadonlySet<string> {
  return new Set(
    (cfg.ai_provider_models?.[providerId] ?? [])
      .filter((model) => model.enabled === false)
      .map((model) => model.id),
  );
}

function withScheme(host: string): string {
  return /^[a-z][a-z\d+.-]*:\/\//i.test(host) ? host : `http://${host}`;
}

function parsedHost(host: string): URL | null {
  const trimmed = host.trim();
  if (!trimmed) return null;
  try {
    return new URL(withScheme(trimmed));
  } catch {
    return null;
  }
}

export function isLoopbackHost(host: string): boolean {
  const url = parsedHost(host);
  if (!url) return false;
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (hostname === "localhost" || hostname.endsWith(".localhost")) return true;
  if (hostname === "::1" || hostname === "0:0:0:0:0:0:0:1" || hostname === "0.0.0.0") return true;
  return /^127(?:\.\d{1,3}){3}$/.test(hostname);
}

function hostLabel(host: string): string {
  const url = parsedHost(host);
  return url?.host || host.trim().slice(0, 120);
}

export type ToolsDestination =
  | { kind: "device" }
  | { kind: "host"; host: string }
  | { kind: "provider"; providerId: string; name: string };

export function toolsOllamaHost(cfg: Pick<AppConfig, "ai_keys">): string {
  return cfg.ai_keys?.ollama?.trim() || DEFAULT_OLLAMA_HOST;
}

export function toolsProviderName(cfg: Pick<AppConfig, "ai_custom_providers">, providerId: string): string {
  if (providerId === MATHPIX_TOOLS_PROVIDER) return MATHPIX_NAME;
  const catalog = getProvider(providerId);
  if (catalog) return catalog.name;
  return cfg.ai_custom_providers?.find((custom) => custom.id === providerId)?.name || providerId;
}

export function toolsProviderConfigured(cfg: AppConfig, providerId: string): boolean {
  return isProviderConfigured(providerId, effectiveProviderKeys(cfg), cfg.ai_custom_providers);
}

export function toolsDestination(
  cfg: AppConfig,
  providerId: string = toolsChoice(cfg)?.provider ?? LOCAL_TOOLS_PROVIDER,
): ToolsDestination {
  if (providerId === LOCAL_TOOLS_PROVIDER) {
    const host = toolsOllamaHost(cfg);
    return isLoopbackHost(host) ? { kind: "device" } : { kind: "host", host: hostLabel(host) };
  }
  if (providerId === MATHPIX_TOOLS_PROVIDER) {
    return { kind: "provider", providerId, name: MATHPIX_NAME };
  }
  const custom = getProvider(providerId)
    ? undefined
    : cfg.ai_custom_providers?.find((provider) => provider.id === providerId);
  if (custom && isLoopbackHost(custom.baseURL)) return { kind: "device" };
  return { kind: "provider", providerId, name: toolsProviderName(cfg, providerId) };
}

export function ollamaCloudDestination(): ToolsDestination {
  return { kind: "provider", providerId: LOCAL_TOOLS_PROVIDER, name: OLLAMA_CLOUD_NAME };
}

export function destinationName(destination: ToolsDestination): string | null {
  switch (destination.kind) {
    case "device":
      return null;
    case "host":
      return `Ollama (${destination.host})`;
    case "provider":
      return destination.name;
  }
}

export interface ToolsChoiceSummary {
  engine: "llm" | "mathpix";
  providerId: string;
  modelId: string;
  label: string;
  destination: ToolsDestination;
  metadata?: ModelMetadata;
}

export function describeToolsChoice(
  cfg: AppConfig,
  ollama?: readonly OllamaModelInfo[] | null,
): ToolsChoiceSummary {
  const choice = toolsChoice(cfg);
  const pickedOllama = choice?.provider === LOCAL_TOOLS_PROVIDER ? choice.model : null;
  const listed = pickedOllama === null ? undefined : ollama?.find((model) => model.name === pickedOllama);
  const destination =
    pickedOllama !== null && ollamaModelIsRemote(listed ?? { name: pickedOllama })
      ? ollamaCloudDestination()
      : toolsDestination(cfg);
  if (!choice) {
    return {
      engine: "llm",
      providerId: LOCAL_TOOLS_PROVIDER,
      modelId: "",
      label: i18n.t(($) => $.researchTools.converterModel.automatic),
      destination,
    };
  }
  if (choice.provider === MATHPIX_TOOLS_PROVIDER) {
    return {
      engine: "mathpix",
      providerId: MATHPIX_TOOLS_PROVIDER,
      modelId: MATHPIX_TOOLS_MODEL,
      label: i18n.t(($) => $.researchTools.converterModel.mathpixModel),
      destination,
    };
  }
  const stored = cfg.ai_provider_models?.[choice.provider]?.find((model) => model.id === choice.model);
  return {
    engine: "llm",
    providerId: choice.provider,
    modelId: choice.model,
    label: stored?.name || choice.model,
    destination,
    ...(stored?.metadata ? { metadata: stored.metadata } : {}),
  };
}

export function toolsImageReady(cfg: AppConfig): boolean {
  const choice = toolsChoice(cfg);
  if (!choice) return Boolean(cfg.ai_keys?.ollama?.trim()) || hasConfiguredProvider(cfg);
  if (choice.provider === LOCAL_TOOLS_PROVIDER || choice.provider === MATHPIX_TOOLS_PROVIDER) return true;
  if (!toolsProviderConfigured(cfg, choice.provider)) return false;
  const stored = cfg.ai_provider_models?.[choice.provider];
  const entry = stored?.find((model) => model.id === choice.model);
  if (stored && !entry?.enabled) return false;
  return visionCapable(choice.provider, choice.model, entry?.metadata);
}
