// How hard a model thinks. Mirrors crates/oleafly-agent/src/effort.rs:
// `effortChoicesFor` follows `effort_choices` and both run the shared table
// in crates/oleafly-agent/tests/fixtures/effort-cases.json.

export type EffortLevel = "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

/** Every level, ascending. */
export const EFFORT_LEVELS: readonly EffortLevel[] = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

/** One models.dev reasoning control: effort names, a token budget, or an on/off switch. */
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

/** Reads models.dev `reasoning_options`; unknown entries and names are ignored. */
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

/** `o1`…`o9` and their variants (`o3-mini`, `o4-mini-high`). */
function openAiOSeries(id: string): boolean {
  return id.length >= 2 && id[0] === "o" && id[1] >= "1" && id[1] <= "9";
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

/**
 * The levels the selector offers for this model, ascending. An empty list
 * hides the selector, and the request then sends no effort.
 */
export function effortChoicesFor(
  providerId: string,
  modelId: string,
  metadata?: ModelReasoningMetadata | null,
): EffortLevel[] {
  const id = asciiLower(modelId);
  const caps = reasoningCaps(metadata);
  const all = [...EFFORT_LEVELS];
  let wire: EffortLevel[] = [];
  let base: EffortLevel[] = [];
  switch (providerId) {
    case "anthropic": {
      wire = ["low", "medium", "high", "xhigh", "max"];
      if (caps.toggle) wire.push("none");
      if (caps.efforts !== null) {
        base = [...caps.efforts];
        if (caps.toggle) base.push("none");
      } else {
        base = anthropicFallback(id, caps);
      }
      break;
    }
    case "openai": {
      wire = all;
      if (caps.efforts !== null) base = [...caps.efforts];
      else if (caps.flag === false) base = [];
      else if (openAiReasoningId(id)) base = ["low", "medium", "high"];
      break;
    }
    case "google": {
      const budgetModel = googleBudgetModel(id, caps);
      const canTurnOff = caps.toggle || caps.budget?.min === 0;
      if (budgetModel) {
        wire = ["low", "medium", "high"];
        if (canTurnOff) wire.push("none");
      } else {
        wire = ["minimal", "low", "medium", "high"];
      }
      if (caps.efforts !== null) {
        base = [...caps.efforts];
      } else if (budgetModel && caps.budget !== null) {
        base = ["low", "medium", "high"];
        if (canTurnOff) base.push("none");
      } else if (budgetModel) {
        base = ["low", "medium", "high"];
        if (id.startsWith("gemini-2.5-flash")) base.push("none");
      } else if (startsWithAny(id, ["gemini-3", "gemini-4", "gemini-flash"])) {
        base = ["low", "medium", "high"];
      }
      // A budget model without metadata may still turn thinking off (Flash).
      if (budgetModel && base.includes("none") && !wire.includes("none")) wire.push("none");
      break;
    }
    case "xai": {
      wire = ["low", "medium", "high", "xhigh"];
      if (caps.efforts !== null) base = [...caps.efforts];
      else if (id.startsWith("grok-4.5")) base = ["low", "medium", "high"];
      else if (startsWithAny(id, ["grok-4.6", "grok-4.7"])) base = ["low", "medium", "high", "xhigh"];
      break;
    }
    case "groq": {
      wire = all;
      if (caps.efforts !== null) base = [...caps.efforts];
      else if (id.startsWith("openai/gpt-oss-")) base = ["low", "medium", "high"];
      break;
    }
    case "openrouter": {
      wire = all;
      base = [...(caps.efforts ?? [])];
      break;
    }
    case "ollama": {
      wire = all;
      if (caps.efforts !== null) base = [...caps.efforts];
      else if (id.includes("gpt-oss")) base = ["low", "medium", "high"];
      else if (caps.flag === true) base = ["none"];
      break;
    }
    default:
      break;
  }
  return sortedUnique(base.filter((level) => wire.includes(level)));
}

/**
 * The accepted level nearest to `requested` (ties go up), or `null` when
 * the model takes no effort.
 */
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
