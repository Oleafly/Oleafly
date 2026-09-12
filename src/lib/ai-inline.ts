import { i18n } from "@/i18n";
import { streamText as streamViaRust } from "@/lib/agent-backend";
import type { DocumentEngineDescriptor } from "@/lib/tauri";

export type InlineEditArgs = {
  engine?: DocumentEngineDescriptor;
  instruction: string;
  selection: string;
  context?: { before: string; after: string };
  signal?: AbortSignal;
  onToken?: (full: string) => void;
};

export const PRESETS: { id: string; label: string; instruction: string }[] = [
  { id: "improve", get label() { return i18n.t(($) => $.core.inlineAi.improve); }, instruction: "Improve the clarity and flow of the selected text." },
  { id: "grammar", get label() { return i18n.t(($) => $.core.inlineAi.grammar); }, instruction: "Fix any spelling and grammar mistakes in the selected text." },
  { id: "concise", get label() { return i18n.t(($) => $.core.inlineAi.concise); }, instruction: "Make the selected text more concise without losing meaning." },
  { id: "expand", get label() { return i18n.t(($) => $.core.inlineAi.expand); }, instruction: "Expand the selected text with more detail." },
  { id: "fix-source", get label() { return i18n.t(($) => $.core.inlineAi.fixSource); }, instruction: "Fix source syntax errors in the selection. Keep it valid for the active document engine." },
  { id: "translate", get label() { return i18n.t(($) => $.core.inlineAi.translate); }, instruction: "Translate the selected text to English." },
];

function markupRule(profile: string): string {
  if (profile === "none") return "Do not introduce markup or engine-specific commands.";
  if (profile === "typst") return "Preserve valid Typst markup and scripting syntax.";
  if (profile === "markdown") {
    return "Preserve valid Pandoc Markdown syntax and YAML front matter.";
  }
  return "Preserve LaTeX validity: balanced braces and environments.";
}

const systemFor = (engine: InlineEditArgs["engine"]) => {
  const profile = engine?.capabilities.formatting_profile ?? "none";
  return [
  profile === "none"
    ? "You edit a fragment whose document engine is not yet known. Make only engine-neutral prose edits."
    : `You edit a fragment of a ${engine?.label ?? "technical"} document.`,
  "Return ONLY the replacement for the selected text.",
  "No code fences, no commentary, no explanation.",
  markupRule(profile),
].join(" ");
};

function stripFence(s: string): string {
  const t = s.trim();
  const m = /^```[a-zA-Z]*\n?([\s\S]*?)\n?```$/.exec(t);
  return (m ? m[1] : t).trim();
}

export async function runInlineCompletion(args: InlineEditArgs): Promise<string> {
  const prompt = [
    args.context?.before ? `Context before:\n${args.context.before}\n` : "",
    `Selected text to edit:\n${args.selection}`,
    args.context?.after ? `\nContext after:\n${args.context.after}` : "",
    `\n\nInstruction: ${args.instruction}`,
  ].join("");

  return stripFence(
    await streamViaRust({
      system: systemFor(args.engine),
      user: prompt,
      signal: args.signal,
      onToken: args.onToken,
    }),
  );
}
