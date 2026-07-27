import {
  OpenAI,
  Anthropic,
  Gemini,
  Groq,
  OpenRouter,
  DeepSeek,
  Mistral,
  Grok,
  Ollama,
  Perplexity,
  ZAI,
} from "@lobehub/icons";
import type { IconType } from "@lobehub/icons";

// Provider id -> lobe icon. Brands that ship a distinct multi-color mark use
// their `.Color` subcomponent; brands whose official mark is already a
// single color (OpenAI, Anthropic, Groq, Grok/xAI, Ollama) use the default
// export directly, since those have no `.Color` member in @lobehub/icons.
const ICONS: Record<string, IconType> = {
  openai: OpenAI,
  anthropic: Anthropic,
  google: Gemini.Color,
  groq: Groq,
  openrouter: OpenRouter.Color,
  deepseek: DeepSeek.Color,
  mistral: Mistral.Color,
  xai: Grok,
  ollama: Ollama,
  perplexity: Perplexity.Color,
  zai: ZAI,
};

const MONO_COLORS = ["#e11d48", "#0ea5e9", "#16a34a", "#a855f7", "#f59e0b", "#64748b"];

function monoColor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return MONO_COLORS[h % MONO_COLORS.length];
}

export function ProviderLogo({ providerId, size = 18 }: { providerId: string; size?: number }) {
  const Icon = ICONS[providerId];
  if (Icon) return <Icon size={size} />;
  const letter = (providerId.trim()[0] ?? "?").toUpperCase();
  return (
    <span
      aria-hidden
      style={{
        width: size,
        height: size,
        background: monoColor(providerId),
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 4,
        color: "#fff",
        fontSize: size * 0.6,
        fontWeight: 600,
      }}
    >
      {letter}
    </span>
  );
}
