export type EffortLevel = "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export const EFFORT_LEVELS: readonly EffortLevel[] = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

export interface ReasoningOption {
  type: "effort" | "budget_tokens" | "toggle";
  values?: readonly string[];
  min?: number;
  max?: number;
}

export interface ModelReasoningMetadata {
  reasoning?: boolean;
  reasoningOptions?: readonly ReasoningOption[];
}

export function isEffortLevel(value: unknown): value is EffortLevel {
  return typeof value === "string" && (EFFORT_LEVELS as readonly string[]).includes(value);
}

interface ReasoningCaps {
  flag: boolean | null;
  efforts: EffortLevel[] | null;
  toggle: boolean;
  budget: { min: number | null; max: number | null } | null;
}

const U32_MAX = 4_294_967_295;

function rank(level: EffortLevel): number {
  return EFFORT_LEVELS.indexOf(level);
}

function sortedUnique(levels: readonly EffortLevel[]): EffortLevel[] {
  return [...new Set(levels)].sort((left, right) => rank(left) - rank(right));
}

function budgetNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? Math.min(value, U32_MAX)
    : null;
}

function asciiLower(value: string): string {
  return value.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
}

function reasoningCaps(metadata: ModelReasoningMetadata | null | undefined): ReasoningCaps {
  const caps: ReasoningCaps = {
    flag: typeof metadata?.reasoning === "boolean" ? metadata.reasoning : null,
    efforts: null,
    toggle: false,
    budget: null,
  };
  const options: unknown = metadata?.reasoningOptions;
  if (!Array.isArray(options)) return caps;
  for (const entry of options as unknown[]) {
    if (!entry || typeof entry !== "object") continue;
    const option = entry as Partial<ReasoningOption>;
    if (option.type === "effort") {
      const values = Array.isArray(option.values) ? option.values.filter(isEffortLevel) : [];
      const merged = sortedUnique([...values, ...(caps.efforts ?? [])]);
      caps.efforts = merged.length > 0 ? merged : null;
    } else if (option.type === "toggle") {
      caps.toggle = true;
    } else if (option.type === "budget_tokens") {
      caps.budget = { min: budgetNumber(option.min), max: budgetNumber(option.max) };
    }
  }
  return caps;
}

function startsWithAny(id: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) => id.startsWith(prefix));
}

function openAiOSeries(id: string): boolean {
  return id.length >= 2 && id.startsWith("o") && id[1] >= "1" && id[1] <= "9";
}

function openAiReasoningId(id: string): boolean {
  return startsWithAny(id, ["gpt-5", "gpt-6", "gpt-7"]) || openAiOSeries(id);
}

/** Gemini models that take a thinking budget (2.5) rather than a level. */
function googleBudgetModel(id: string, caps: ReasoningCaps): boolean {
  if (caps.budget !== null && caps.efforts === null) return true;
  const noMetadata =
    caps.flag === null && caps.efforts === null && caps.budget === null && !caps.toggle;
  return noMetadata && id.startsWith("gemini-2.5");
}

function anthropicFallback(id: string, caps: ReasoningCaps): EffortLevel[] {
  if (caps.budget !== null) return [];
  if (
    startsWithAny(id, [
      "claude-opus-5",
      "claude-sonnet-5",
      "claude-haiku-5",
      "claude-fable-",
      "claude-mythos-",
      "claude-opus-4-7",
      "claude-opus-4-8",
    ])
  ) {
    return ["low", "medium", "high", "xhigh", "max"];
  }
  if (startsWithAny(id, ["claude-opus-4-6", "claude-sonnet-4-6"])) {
    return ["low", "medium", "high", "max"];
  }
  if (id.startsWith("claude-opus-4-5")) return ["low", "medium", "high"];
  return [];
}

interface ProviderChoices {
  wire: EffortLevel[];
  base: EffortLevel[];
}

const LOW_TO_HIGH: readonly EffortLevel[] = ["low", "medium", "high"];

function anthropicChoices(id: string, caps: ReasoningCaps): ProviderChoices {
  const wire: EffortLevel[] = ["low", "medium", "high", "xhigh", "max"];
  if (caps.toggle) wire.push("none");
  if (caps.efforts === null) return { wire, base: anthropicFallback(id, caps) };
  const base = [...caps.efforts];
  if (caps.toggle) base.push("none");
  return { wire, base };
}

function openAiChoices(id: string, caps: ReasoningCaps): ProviderChoices {
  const wire = [...EFFORT_LEVELS];
  if (caps.efforts !== null) return { wire, base: [...caps.efforts] };
  if (caps.flag === false || !openAiReasoningId(id)) return { wire, base: [] };
  return { wire, base: [...LOW_TO_HIGH] };
}

/** The levels a Gemini model supports when its metadata names none. */
function googleBase(
  id: string,
  caps: ReasoningCaps,
  budgetModel: boolean,
  canTurnOff: boolean,
): EffortLevel[] {
  if (caps.efforts !== null) return [...caps.efforts];
  if (budgetModel) {
    const base = [...LOW_TO_HIGH];
    const turnsOff = caps.budget === null ? id.startsWith("gemini-2.5-flash") : canTurnOff;
    if (turnsOff) base.push("none");
    return base;
  }
  if (startsWithAny(id, ["gemini-3", "gemini-4", "gemini-flash"])) return [...LOW_TO_HIGH];
  return [];
}

function googleChoices(id: string, caps: ReasoningCaps): ProviderChoices {
  const budgetModel = googleBudgetModel(id, caps);
  const canTurnOff = caps.toggle || caps.budget?.min === 0;
  const wire: EffortLevel[] = budgetModel ? [...LOW_TO_HIGH] : ["minimal", ...LOW_TO_HIGH];
  if (budgetModel && canTurnOff) wire.push("none");
  const base = googleBase(id, caps, budgetModel, canTurnOff);
  if (budgetModel && base.includes("none") && !wire.includes("none")) wire.push("none");
  return { wire, base };
}

function xaiChoices(id: string, caps: ReasoningCaps): ProviderChoices {
  const wire: EffortLevel[] = ["low", "medium", "high", "xhigh"];
  if (caps.efforts !== null) return { wire, base: [...caps.efforts] };
  if (id.startsWith("grok-4.5")) return { wire, base: [...LOW_TO_HIGH] };
  if (startsWithAny(id, ["grok-4.6", "grok-4.7"])) return { wire, base: [...wire] };
  return { wire, base: [] };
}

function groqChoices(id: string, caps: ReasoningCaps): ProviderChoices {
  const wire = [...EFFORT_LEVELS];
  if (caps.efforts !== null) return { wire, base: [...caps.efforts] };
  if (id.startsWith("openai/gpt-oss-")) return { wire, base: [...LOW_TO_HIGH] };
  return { wire, base: [] };
}

function openRouterChoices(caps: ReasoningCaps): ProviderChoices {
  return { wire: [...EFFORT_LEVELS], base: [...(caps.efforts ?? [])] };
}

function ollamaChoices(id: string, caps: ReasoningCaps): ProviderChoices {
  const wire = [...EFFORT_LEVELS];
  if (caps.efforts !== null) return { wire, base: [...caps.efforts] };
  if (id.includes("gpt-oss")) return { wire, base: [...LOW_TO_HIGH] };
  if (caps.flag === true) return { wire, base: ["none"] };
  return { wire, base: [] };
}

function deepSeekChoices(id: string, caps: ReasoningCaps): ProviderChoices {
  const wire: EffortLevel[] = ["none", "low", "high", "max"];
  if (caps.efforts !== null) {
    return { wire, base: caps.toggle ? [...caps.efforts, "none"] : [...caps.efforts] };
  }
  if (startsWithAny(id, ["deepseek-flash", "deepseek-v4"])) return { wire, base: [...wire] };
  return { wire, base: [] };
}

function providerChoices(providerId: string, id: string, caps: ReasoningCaps): ProviderChoices {
  switch (providerId) {
    case "anthropic":
      return anthropicChoices(id, caps);
    case "openai":
      return openAiChoices(id, caps);
    case "google":
      return googleChoices(id, caps);
    case "xai":
      return xaiChoices(id, caps);
    case "groq":
      return groqChoices(id, caps);
    case "openrouter":
      return openRouterChoices(caps);
    case "ollama":
      return ollamaChoices(id, caps);
    case "deepseek":
      return deepSeekChoices(id, caps);
    default:
      return { wire: [], base: [] };
  }
}

export function effortChoicesFor(
  providerId: string,
  modelId: string,
  metadata?: ModelReasoningMetadata | null,
): EffortLevel[] {
  const { wire, base } = providerChoices(providerId, asciiLower(modelId), reasoningCaps(metadata));
  return sortedUnique(base.filter((level) => wire.includes(level)));
}

export function clampEffort(
  requested: EffortLevel,
  choices: readonly EffortLevel[],
): EffortLevel | null {
  if (choices.includes(requested)) return requested;
  let best: EffortLevel | null = null;
  for (const choice of choices) {
    if (best === null) {
      best = choice;
      continue;
    }
    const distance = Math.abs(rank(choice) - rank(requested));
    const bestDistance = Math.abs(rank(best) - rank(requested));
    if (distance < bestDistance || (distance === bestDistance && rank(choice) > rank(best))) {
      best = choice;
    }
  }
  return best;
}
