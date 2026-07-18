import { streamText } from "ai";
import { getConfig } from "@/lib/tauri";
import { resolveActiveModel, type AIConfigLike } from "@/lib/ai-providers";
import type { DocumentEngineDescriptor } from "@/lib/tauri";

export type InlineEditArgs = {
  config?: AIConfigLike;
  engine?: DocumentEngineDescriptor;
  instruction: string;
  selection: string;
  context?: { before: string; after: string };
  signal?: AbortSignal;
  onToken?: (full: string) => void;
};

export const PRESETS: { id: string; label: string; instruction: string }[] = [
  { id: "improve", label: "Improve", instruction: "Improve the clarity and flow of the selected text." },
  { id: "grammar", label: "Fix grammar", instruction: "Fix any spelling and grammar mistakes in the selected text." },
  { id: "concise", label: "Make concise", instruction: "Make the selected text more concise without losing meaning." },
  { id: "expand", label: "Expand", instruction: "Expand the selected text with more detail." },
  { id: "fix-source", label: "Fix source", instruction: "Fix source syntax errors in the selection; keep it valid for the active document engine." },
  { id: "translate", label: "Translate", instruction: "Translate the selected text to English." },
];

const systemFor = (engine: InlineEditArgs["engine"]) => {
  const profile = engine?.capabilities.formatting_profile ?? "none";
  return [
  profile === "none"
    ? "You edit a fragment whose document engine is not yet known. Make only engine-neutral prose edits."
    : `You edit a fragment of a ${engine?.label ?? "technical"} document.`,
  "Return ONLY the replacement for the selected text.",
  "No code fences, no commentary, no explanation.",
  profile === "none"
    ? "Do not introduce markup or engine-specific commands."
    : profile === "typst"
    ? "Preserve valid Typst markup and scripting syntax."
    : profile === "markdown"
    ? "Preserve valid Pandoc Markdown syntax and YAML front matter."
    : "Preserve LaTeX validity: balanced braces and environments.",
].join(" ");
};

function stripFence(s: string): string {
  const t = s.trim();
  const m = t.match(/^```[a-zA-Z]*\n?([\s\S]*?)\n?```$/);
  return (m ? m[1] : t).trim();
}

export async function runInlineCompletion(args: InlineEditArgs): Promise<string> {
  const cfg = args.config ?? (await getConfig());
  const { model } = resolveActiveModel(cfg);
  const prompt = [
    args.context?.before ? `Context before:\n${args.context.before}\n` : "",
    `Selected text to edit:\n${args.selection}`,
    args.context?.after ? `\nContext after:\n${args.context.after}` : "",
    `\n\nInstruction: ${args.instruction}`,
  ].join("");

  const result = streamText({
    model,
    system: systemFor(args.engine),
    prompt,
    abortSignal: args.signal,
  });

  let full = "";
  for await (const delta of result.textStream) {
    full += delta;
    args.onToken?.(full);
  }
  return stripFence(full);
}
