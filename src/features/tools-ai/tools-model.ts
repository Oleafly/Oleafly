// Which model a Tools conversion runs on. The saved choice is followed
// exactly: a chosen model that cannot run is an error, never a quiet switch
// to another provider. Nothing local falls back to a hosted model, except
// the editor's Image to LaTeX/Typst with no Tools model saved, which used the
// assistant's model before the Tools model existed (see `assistantFallback`).
import { pickActiveProvider } from "@oleafly/ai-core";
import { i18n } from "@/i18n";
import { mergeFetchedModels } from "@/lib/ai-model-state";
import { mathpixKeyStatus } from "@/lib/mathpix";
import { listOllamaModelDetails, type OllamaModelInfo } from "@/lib/ollama";
import { getConfig, setConfig, type AppConfig, type ModelMetadata, type ToolsModelChoice } from "@/lib/tauri";
import { useSettingsStore } from "@/store/settings";
import { ocrProfileFor, type OcrProfile, type OcrProfileId } from "./ocr-profiles";
import {
  disabledModels,
  LOCAL_TOOLS_PROVIDER,
  MATHPIX_TOOLS_PROVIDER,
  ollamaModelSeesImages,
  toolsChoice,
  toolsDestination,
  toolsOllamaHost,
  toolsProviderConfigured,
  toolsProviderName,
  visionCapable,
  type ToolsDestination,
} from "./tools-choice";

/** `image`: a photo, page or equation image. `equation-text`: typed math. */
export type ToolsTask = "image" | "equation-text";

export interface ResolvedLlm {
  engine: "llm";
  providerId: string;
  modelId: string;
  label: string;
  /** Not Ollama: hosted API limits apply. */
  hosted: boolean;
  /** Where the input goes (privacy). */
  destination: ToolsDestination;
  metadata?: ModelMetadata;
  profile: OcrProfile | null;
}

export interface ResolvedMathpix {
  engine: "mathpix";
  label: string;
  hosted: true;
  destination: ToolsDestination;
}

export type ResolvedToolsModel = ResolvedLlm | ResolvedMathpix;

/** A Tools model that cannot run. `settings` names the place that fixes it:
 * Settings, AI (the Ollama card) or Settings, AI, Tools. */
export class ToolsModelError extends Error {
  readonly settings: "ai" | "ai-tools";

  constructor(message: string, settings: "ai" | "ai-tools" = "ai-tools") {
    super(message);
    this.name = "ToolsModelError";
    this.settings = settings;
  }
}

/** Ollama is missing, stopped or has no fitting model: the Ollama card fixes it. */
export class LocalModelError extends ToolsModelError {
  constructor(message: string) {
    super(message, "ai");
    this.name = "LocalModelError";
  }
}

export const TOOLS_MAX_OUTPUT_TOKENS = 12_000;
export const HOSTED_FALLBACK_OUTPUT_TOKENS = 8_192;

/** The reply budget: 12,000 tokens, or less when the model's output limit
 * is lower. Hosted models without metadata get 8,192, which every hosted
 * vision model accepts. */
export function toolsMaxTokens(model: Pick<ResolvedLlm, "hosted" | "metadata">): number {
  const limit = model.metadata?.outputLimit;
  if (typeof limit === "number" && Number.isFinite(limit) && limit > 0) {
    return Math.min(TOOLS_MAX_OUTPUT_TOKENS, Math.floor(limit));
  }
  return model.hosted ? HOSTED_FALLBACK_OUTPUT_TOKENS : TOOLS_MAX_OUTPUT_TOKENS;
}

const PROFILE_ORDER: readonly OcrProfileId[] = ["glm-ocr", "deepseek-ocr", "dots-ocr"];

/** The automatic local choice: an OCR model first, then the assistant's
 * Ollama model, then the first that fits. Typed equations need a language
 * model, so OCR-only models are skipped for them. */
export function pickLocalModel(
  models: readonly OllamaModelInfo[],
  task: ToolsTask,
  assistantModel: string,
  disabled: ReadonlySet<string>,
): string | null {
  const usable = models.filter((model) => !disabled.has(model.name));
  if (task === "equation-text") {
    const text = usable.filter((model) => !ocrProfileFor(model.name));
    return text.find((model) => model.name === assistantModel)?.name ?? text[0]?.name ?? null;
  }
  const vision = usable.filter(ollamaModelSeesImages);
  for (const id of PROFILE_ORDER) {
    const hit = vision.find((model) => ocrProfileFor(model.name)?.id === id);
    if (hit) return hit.name;
  }
  return vision.find((model) => model.name === assistantModel)?.name ?? vision[0]?.name ?? null;
}

/** The backend refuses a model missing from a stored Ollama list, so a model
 * pulled since the last Settings refresh is added before it is used. */
export async function ensureOllamaModelEnabled(
  cfg: AppConfig,
  modelId: string,
  models: readonly OllamaModelInfo[],
): Promise<void> {
  const stored = cfg.ai_provider_models?.[LOCAL_TOOLS_PROVIDER];
  if (!stored || stored.some((model) => model.id === modelId && model.enabled)) return;
  const latest = await getConfig();
  const merged = mergeFetchedModels(
    latest.ai_provider_models?.[LOCAL_TOOLS_PROVIDER] ?? [],
    models.map((model) => ({ id: model.name, name: model.name })),
  );
  const next: AppConfig = {
    ...latest,
    ai_provider_models: { ...latest.ai_provider_models, [LOCAL_TOOLS_PROVIDER]: merged },
  };
  await setConfig(next);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("oleafly:ai-config-changed", { detail: next }));
  }
}

function offlineError(): ToolsModelError {
  return new ToolsModelError(i18n.t(($) => $.researchTools.converterModel.errors.offline));
}

async function resolveMathpix(task: ToolsTask, cfg: AppConfig): Promise<ResolvedMathpix> {
  if (task === "equation-text") {
    throw new ToolsModelError(
      i18n.t(($) => $.researchTools.converterModel.errors.imagesOnly, { model: "Mathpix" }),
    );
  }
  if (useSettingsStore.getState().offline) throw offlineError();
  let configured = false;
  try {
    configured = (await mathpixKeyStatus()).configured;
  } catch {
    configured = false;
  }
  if (!configured) {
    throw new ToolsModelError(i18n.t(($) => $.researchTools.converterModel.errors.mathpixNotSetUp));
  }
  return { engine: "mathpix", label: "Mathpix", hosted: true, destination: toolsDestination(cfg) };
}

/** Throws when the Ollama model the user chose cannot run the task. */
function assertLocalModelCanRun(
  task: ToolsTask,
  explicit: string,
  models: readonly OllamaModelInfo[],
  disabled: ReadonlySet<string>,
): void {
  const info = models.find((model) => model.name === explicit);
  if (!info) {
    throw new LocalModelError(
      i18n.t(($) => $.researchTools.converterModel.errors.localModelGone, { model: explicit }),
    );
  }
  if (disabled.has(explicit)) {
    throw new ToolsModelError(
      i18n.t(($) => $.researchTools.converterModel.errors.modelDisabled, { model: explicit }),
    );
  }
  if (task === "equation-text" && ocrProfileFor(explicit)) {
    throw new ToolsModelError(
      i18n.t(($) => $.researchTools.converterModel.errors.imagesOnly, { model: explicit }),
    );
  }
  if (task === "image" && !ollamaModelSeesImages(info)) {
    throw new ToolsModelError(
      i18n.t(($) => $.researchTools.converterModel.errors.cannotSeeImages, { model: explicit }),
    );
  }
}

async function resolveLocal(task: ToolsTask, cfg: AppConfig, explicit: string): Promise<ResolvedLlm> {
  let models: OllamaModelInfo[];
  try {
    models = await listOllamaModelDetails(toolsOllamaHost(cfg));
  } catch {
    throw new LocalModelError(i18n.t(($) => $.researchTools.converterErrors.ollamaUnavailable));
  }
  const disabled = disabledModels(cfg, LOCAL_TOOLS_PROVIDER);
  let modelId: string;
  if (explicit) {
    assertLocalModelCanRun(task, explicit, models, disabled);
    modelId = explicit;
  } else {
    const assistantModel = cfg.ai_provider === LOCAL_TOOLS_PROVIDER ? cfg.ai_model : "";
    const picked = pickLocalModel(models, task, assistantModel, disabled);
    if (!picked) {
      throw new LocalModelError(
        task === "image"
          ? i18n.t(($) => $.researchTools.converterErrors.visionModelMissing)
          : i18n.t(($) => $.researchTools.converterErrors.localModelMissing),
      );
    }
    modelId = picked;
  }
  await ensureOllamaModelEnabled(cfg, modelId, models);
  return {
    engine: "llm",
    providerId: LOCAL_TOOLS_PROVIDER,
    modelId,
    label: modelId,
    hosted: false,
    destination: toolsDestination(cfg),
    profile: ocrProfileFor(modelId),
  };
}

function resolveHosted(task: ToolsTask, cfg: AppConfig, choice: ToolsModelChoice): ResolvedLlm {
  if (useSettingsStore.getState().offline) throw offlineError();
  if (!toolsProviderConfigured(cfg, choice.provider)) {
    throw new ToolsModelError(
      i18n.t(($) => $.researchTools.converterModel.errors.providerNotConfigured, {
        provider: toolsProviderName(cfg, choice.provider),
      }),
    );
  }
  const stored = cfg.ai_provider_models?.[choice.provider];
  const entry = stored?.find((model) => model.id === choice.model);
  const label = entry?.name || choice.model;
  if (stored && !entry?.enabled) {
    throw new ToolsModelError(
      i18n.t(($) => $.researchTools.converterModel.errors.modelDisabled, { model: label }),
    );
  }
  if (task === "image" && !visionCapable(choice.provider, choice.model, entry?.metadata)) {
    throw new ToolsModelError(
      i18n.t(($) => $.researchTools.converterModel.errors.cannotSeeImages, { model: label }),
    );
  }
  return {
    engine: "llm",
    providerId: choice.provider,
    modelId: choice.model,
    label,
    hosted: true,
    destination: toolsDestination(cfg, choice.provider),
    ...(entry?.metadata ? { metadata: entry.metadata } : {}),
    profile: ocrProfileFor(choice.model),
  };
}

/** The assistant's own model, when it is not Ollama and can do the task. */
function assistantFallbackModel(task: ToolsTask, cfg: AppConfig): ResolvedLlm | null {
  const { providerId, modelId } = pickActiveProvider(cfg);
  if (providerId === LOCAL_TOOLS_PROVIDER) return null;
  try {
    return resolveHosted(task, cfg, { provider: providerId, model: modelId });
  } catch {
    return null;
  }
}

export interface ResolveToolsOptions {
  /** With no Tools model saved and no local model that can run, use the
   * assistant's model when it can. Only the editor's Image to LaTeX/Typst
   * asks for this: it used the assistant's model before 0.4.8, so a setup
   * without Ollama keeps working. */
  assistantFallback?: boolean;
}

/** The model this conversion runs on, read fresh from the saved settings. */
export async function resolveToolsModel(
  task: ToolsTask,
  options: ResolveToolsOptions = {},
): Promise<ResolvedToolsModel> {
  const cfg = await getConfig();
  const choice = toolsChoice(cfg);
  if (choice?.provider === MATHPIX_TOOLS_PROVIDER) return resolveMathpix(task, cfg);
  if (choice && choice.provider !== LOCAL_TOOLS_PROVIDER) return resolveHosted(task, cfg, choice);
  try {
    return await resolveLocal(task, cfg, choice?.model ?? "");
  } catch (error) {
    const fallback =
      !choice && options.assistantFallback && error instanceof LocalModelError
        ? assistantFallbackModel(task, cfg)
        : null;
    if (fallback) return fallback;
    throw error;
  }
}
