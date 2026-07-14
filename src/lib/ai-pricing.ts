// Approximate public list prices (USD per 1M tokens) for common models.
// Used only for rough UI estimates — not billing. Update periodically.
// Sources: provider list prices as of 2025–2026; Z.AI coding plan treated as ~0.

export interface ModelPrice {
  inputPerMTok: number;
  outputPerMTok: number;
  note?: string;
}

const PRICES: Record<string, ModelPrice> = {
  // OpenAI
  "gpt-4o": { inputPerMTok: 2.5, outputPerMTok: 10 },
  "gpt-4o-mini": { inputPerMTok: 0.15, outputPerMTok: 0.6 },
  "gpt-4.1": { inputPerMTok: 2, outputPerMTok: 8 },
  "gpt-4.1-mini": { inputPerMTok: 0.4, outputPerMTok: 1.6 },
  "o3-mini": { inputPerMTok: 1.1, outputPerMTok: 4.4 },
  // Anthropic
  "claude-sonnet-4-20250514": { inputPerMTok: 3, outputPerMTok: 15 },
  "claude-3-5-sonnet-20241022": { inputPerMTok: 3, outputPerMTok: 15 },
  "claude-3-5-haiku-20241022": { inputPerMTok: 0.8, outputPerMTok: 4 },
  // Groq (approx)
  "llama-3.3-70b-versatile": { inputPerMTok: 0.59, outputPerMTok: 0.79 },
  "llama-3.1-8b-instant": { inputPerMTok: 0.05, outputPerMTok: 0.08 },
  // OpenRouter catalog ids
  "openai/gpt-4o-mini": { inputPerMTok: 0.15, outputPerMTok: 0.6 },
  "anthropic/claude-3.5-sonnet": { inputPerMTok: 3, outputPerMTok: 15 },
  "google/gemini-flash-1.5": { inputPerMTok: 0.075, outputPerMTok: 0.3 },
  "meta-llama/llama-3.3-70b-instruct": { inputPerMTok: 0.1, outputPerMTok: 0.3 },
  // DeepSeek
  "deepseek-chat": { inputPerMTok: 0.27, outputPerMTok: 1.1 },
  "deepseek-reasoner": { inputPerMTok: 0.55, outputPerMTok: 2.19 },
  // Mistral
  "mistral-large-latest": { inputPerMTok: 2, outputPerMTok: 6 },
  "codestral-latest": { inputPerMTok: 0.3, outputPerMTok: 0.9 },
  "mistral-small-latest": { inputPerMTok: 0.1, outputPerMTok: 0.3 },
  // xAI
  "grok-2": { inputPerMTok: 2, outputPerMTok: 10 },
  "grok-beta": { inputPerMTok: 5, outputPerMTok: 15 },
  // Local / plan-based — free at the meter
  "llama3.2": { inputPerMTok: 0, outputPerMTok: 0, note: "local" },
  "qwen2.5": { inputPerMTok: 0, outputPerMTok: 0, note: "local" },
  mistral: { inputPerMTok: 0, outputPerMTok: 0, note: "local" },
  gemma2: { inputPerMTok: 0, outputPerMTok: 0, note: "local" },
  "glm-5.2": { inputPerMTok: 0, outputPerMTok: 0, note: "plan" },
  "glm-4.6": { inputPerMTok: 0, outputPerMTok: 0, note: "plan" },
  "glm-4.5-air": { inputPerMTok: 0, outputPerMTok: 0, note: "plan" },
  "glm-4.5": { inputPerMTok: 0, outputPerMTok: 0, note: "plan" },
};

const DEFAULT_PRICE: ModelPrice = { inputPerMTok: 1, outputPerMTok: 3, note: "estimate" };

export function lookupPrice(modelId: string): ModelPrice {
  if (!modelId) return DEFAULT_PRICE;
  if (PRICES[modelId]) return PRICES[modelId];
  const bare = modelId.includes("/") ? modelId.split("/").pop()! : modelId;
  if (PRICES[bare]) return PRICES[bare];
  // Longest PAID key that is a substring of the id. Free entries (mistral, gemma2,
  // glm-*, ...) are skipped so a paid id like "mistral-large-2411" doesn't get
  // mispriced as the free "mistral" family. Only `modelId.includes(k)` is tested
  // (not the reverse), so "gpt-4" can't borrow "gpt-4o" pricing.
  const paid = Object.entries(PRICES)
    .filter(([, v]) => v.inputPerMTok > 0 || v.outputPerMTok > 0)
    .sort((a, b) => b[0].length - a[0].length);
  for (const [k, v] of paid) {
    if (modelId.includes(k)) return v;
  }
  return DEFAULT_PRICE;
}

export function estimateUsd(
  modelId: string,
  inputTokens: number,
  outputTokens: number,
): { usd: number; price: ModelPrice } {
  const price = lookupPrice(modelId);
  const usd =
    (Math.max(0, inputTokens) / 1_000_000) * price.inputPerMTok +
    (Math.max(0, outputTokens) / 1_000_000) * price.outputPerMTok;
  return { usd, price };
}

export function formatUsd(usd: number): string {
  if (usd <= 0) return "$0";
  if (usd < 0.01) return `~$${usd.toFixed(4)}`;
  if (usd < 1) return `~$${usd.toFixed(3)}`;
  return `~$${usd.toFixed(2)}`;
}
