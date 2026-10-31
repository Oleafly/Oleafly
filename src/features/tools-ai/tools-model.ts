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
  ollamaCloudDestination,
  ollamaModelIsRemote,
  ollamaModelSeesImages,
  toolsChoice,
  toolsDestination,
  toolsOllamaHost,
  toolsProviderConfigured,
  toolsProviderName,
  visionCapable,
  type ToolsDestination,
} from "./tools-choice";

export type ToolsTask = "image" | "equation-text";

export interface ResolvedLlm {
  engine: "llm";
  providerId: string;
  modelId: string;
  label: string;
  /** Not a model Ollama runs here: hosted API limits apply. Ollama Cloud
   * models are hosted; a custom provider on this computer is not. */
  hosted: boolean;
  destination: ToolsDestination;
  metadata?: ModelMetadata;
  profile: OcrProfile | null;
  assistantFallback?: boolean;
}

export interface ResolvedMathpix {
  engine: "mathpix";
  label: string;
  hosted: true;
  destination: ToolsDestination;
}

export type ResolvedToolsModel = ResolvedLlm | ResolvedMathpix;

export type ToolsSettingsTarget = "ai" | "ai-tools" | "ai-providers";

export class ToolsModelError extends Error {
  readonly settings: ToolsSettingsTarget;

  constructor(message: string, settings: ToolsSettingsTarget = "ai-tools") {
    super(message);
    this.name = "ToolsModelError";
    this.settings = settings;
  }
}

export class LocalModelError extends ToolsModelError {
  constructor(message: string) {
    super(message, "ai");
    this.name = "LocalModelError";
  }
}

export const TOOLS_MAX_OUTPUT_TOKENS = 12_000;
export const HOSTED_FALLBACK_OUTPUT_TOKENS = 8_192;

export function toolsMaxTokens(model: Pick<ResolvedLlm, "hosted" | "metadata">): number {
  const limit = model.metadata?.outputLimit;
  if (typeof limit === "number" && Number.isFinite(limit) && limit > 0) {
    return Math.min(TOOLS_MAX_OUTPUT_TOKENS, Math.floor(limit));
  }
  return model.hosted ? HOSTED_FALLBACK_OUTPUT_TOKENS : TOOLS_MAX_OUTPUT_TOKENS;
}

const PROFILE_ORDER: readonly OcrProfileId[] = ["glm-ocr", "deepseek-ocr", "dots-ocr"];

/** Whether a model can answer a chat request. Ollama lists embedding-only
 * models (bge-m3, all-minilm) next to chat models; without capabilities the
 * model is given the benefit of the doubt. */
function answersChat(model: OllamaModelInfo): boolean {
  return !model.capabilities || model.capabilities.includes("completion");
}

/** The automatic local choice: an OCR model first, then the assistant's
 * Ollama model, then the first that fits. Typed equations need a language
 * model, so OCR-only models are skipped for them. Ollama Cloud models are
 * never picked: they do not run on this computer. */
export function pickLocalModel(
  models: readonly OllamaModelInfo[],
  task: ToolsTask,
  assistantModel: string,
  disabled: ReadonlySet<string>,
): string | null {
  const usable = models.filter(
    (model) => !disabled.has(model.name) && !ollamaModelIsRemote(model) && answersChat(model),
  );
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
      "ai-providers",
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
  // An Ollama Cloud model the user picked runs on ollama.com: it is hosted,
  // so it gets the hosted image budget and says where the input goes.
  const remote = ollamaModelIsRemote(models.find((model) => model.name === modelId) ?? { name: modelId });
  if (remote && useSettingsStore.getState().offline) throw offlineError();
  await ensureOllamaModelEnabled(cfg, modelId, models);
  return {
    engine: "llm",
    providerId: LOCAL_TOOLS_PROVIDER,
    modelId,
    label: modelId,
    hosted: remote,
    destination: remote ? ollamaCloudDestination() : toolsDestination(cfg),
    profile: ocrProfileFor(modelId),
  };
}

function resolveHosted(task: ToolsTask, cfg: AppConfig, choice: ToolsModelChoice): ResolvedLlm {
  const destination = toolsDestination(cfg, choice.provider);
  const onDevice = destination.kind === "device";
  if (!onDevice && useSettingsStore.getState().offline) throw offlineError();
  if (!toolsProviderConfigured(cfg, choice.provider)) {
    throw new ToolsModelError(
      i18n.t(($) => $.researchTools.converterModel.errors.providerNotConfigured, {
        provider: toolsProviderName(cfg, choice.provider),
      }),
      "ai-providers",
    );
  }
  const stored = cfg.ai_provider_models?.[choice.provider];
  const entry = stored?.find((model) => model.id === choice.model);
  const label = entry?.name || choice.model;
  if (stored && !entry) {
    throw new ToolsModelError(
      i18n.t(($) => $.researchTools.converterModel.errors.modelUnavailable, {
        model: label,
        provider: toolsProviderName(cfg, choice.provider),
      }),
    );
  }
  if (entry && !entry.enabled) {
    throw new ToolsModelError(
      i18n.t(($) => $.researchTools.converterModel.errors.modelDisabled, { model: label }),
      "ai-providers",
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
    hosted: !onDevice,
    destination,
    ...(entry?.metadata ? { metadata: entry.metadata } : {}),
    profile: ocrProfileFor(choice.model),
  };
}

function assistantFallbackModel(task: ToolsTask, cfg: AppConfig): ResolvedLlm | null {
  const { providerId, modelId } = pickActiveProvider(cfg);
  if (providerId === LOCAL_TOOLS_PROVIDER || !modelId) return null;
  try {
    return { ...resolveHosted(task, cfg, { provider: providerId, model: modelId }), assistantFallback: true };
  } catch {
    return null;
  }
}

export function editorImageFallback(
  cfg: AppConfig,
  ollama: readonly OllamaModelInfo[] | null,
): ToolsDestination | null {
  if (toolsChoice(cfg)) return null;
  if (ollama) {
    const assistantModel = cfg.ai_provider === LOCAL_TOOLS_PROVIDER ? cfg.ai_model : "";
    const disabled = disabledModels(cfg, LOCAL_TOOLS_PROVIDER);
    if (pickLocalModel(ollama, "image", assistantModel, disabled)) return null;
  }
  return assistantFallbackModel("image", cfg)?.destination ?? null;
}

export interface ResolveToolsOptions {
  assistantFallback?: boolean;
}

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
