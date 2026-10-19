// The model the Tools converters use, and where their images go. Pure and
// small: the editor toolbar imports it on startup to decide whether to show
// Image to LaTeX/Typst. Nothing here talks to a model.
import {
  getProvider,
  hasConfiguredProvider,
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

/** The saved choice, or null for the automatic local model. */
export function toolsChoice(cfg: Pick<AppConfig, "ai_tools_model">): ToolsModelChoice | null {
  const saved = cfg.ai_tools_model;
  const provider = saved?.provider?.trim() ?? "";
  const model = saved?.model?.trim() ?? "";
  if (!provider) return null;
  if (provider === LOCAL_TOOLS_PROVIDER && !model) return null;
  return { provider, model };
}

/** What a model picker selection saves: null for Automatic. */
export function choiceFromSelection(providerId: string, modelId: string): ToolsModelChoice | null {
  return toolsChoice({ ai_tools_model: { provider: providerId, model: modelId } });
}

/** Whether a model can read images: its metadata or name says so, or it is
 * a known OCR model. */
export function visionCapable(providerId: string, modelId: string, metadata?: ModelMetadata): boolean {
  return (
    modelSupportsVision(providerId, modelId, metadata?.inputModalities) || ocrProfileFor(modelId) !== null
  );
}

/** Ollama's capabilities when it reports them, the model name otherwise. */
export function ollamaModelSeesImages(info: OllamaModelInfo): boolean {
  if (info.capabilities) return info.capabilities.includes("vision");
  return visionCapable(LOCAL_TOOLS_PROVIDER, info.name);
}

/** Models the user turned off in Settings for this provider. */
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

/** Whether `host` (a URL or `host:port`) is this computer. */
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
  /** Ollama on another computer, such as "192.168.1.9:11434". */
  | { kind: "host"; host: string }
  /** A hosted provider or Mathpix. */
  | { kind: "provider"; providerId: string; name: string };

/** The Ollama host the Tools use: the saved one, or this computer's. */
export function toolsOllamaHost(cfg: Pick<AppConfig, "ai_keys">): string {
  return cfg.ai_keys?.ollama?.trim() || DEFAULT_OLLAMA_HOST;
}

/** A provider's display name, custom providers included. */
export function toolsProviderName(cfg: Pick<AppConfig, "ai_custom_providers">, providerId: string): string {
  if (providerId === MATHPIX_TOOLS_PROVIDER) return MATHPIX_NAME;
  const catalog = getProvider(providerId);
  if (catalog) return catalog.name;
  return cfg.ai_custom_providers?.find((custom) => custom.id === providerId)?.name || providerId;
}

/** Whether a provider has a key (or needs none), as the backend decides. */
export function toolsProviderConfigured(cfg: AppConfig, providerId: string): boolean {
  if ((cfg.ai_keys?.[providerId] ?? "").trim()) return true;
  if (cfg.ai_provider === providerId && (cfg.ai_api_key ?? "").trim()) return true;
  return Boolean(cfg.ai_custom_providers?.find((custom) => custom.id === providerId)?.keyOptional);
}

/** Where the Tools send images with the current choice, or with `providerId`. */
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
  // The backend resolves a catalog id before a custom provider of that id.
  const custom = getProvider(providerId)
    ? undefined
    : cfg.ai_custom_providers?.find((provider) => provider.id === providerId);
  if (custom && isLoopbackHost(custom.baseURL)) return { kind: "device" };
  return { kind: "provider", providerId, name: toolsProviderName(cfg, providerId) };
}

/** A short name for where the images went, or null for this computer. */
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
  /** "" = automatic local. */
  modelId: string;
  /** Stored model name, model id, "Mathpix OCR", or "Automatic (best local model)". */
  label: string;
  destination: ToolsDestination;
  metadata?: ModelMetadata;
}

export function describeToolsChoice(cfg: AppConfig): ToolsChoiceSummary {
  const choice = toolsChoice(cfg);
  const destination = toolsDestination(cfg);
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

/** Whether the editor toolbar offers Image to LaTeX/Typst. Automatic shows
 * it whenever any AI is set up; the conversion explains what is missing. */
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
