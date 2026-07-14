import { streamText } from "ai";
import { getConfig } from "@/lib/tauri";
import { resolveActiveModel } from "@/lib/ai-providers";

export type InlineEditArgs = {
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
  { id: "fix-latex", label: "Fix LaTeX", instruction: "Fix any LaTeX syntax errors in the selection; keep it valid." },
  { id: "translate", label: "Translate", instruction: "Translate the selected text to English." },
];

const SYSTEM = [
  "You edit a fragment of a LaTeX document.",
  "Return ONLY the replacement for the selected text.",
  "No code fences, no commentary, no explanation.",
  "Preserve LaTeX validity: balanced braces and environments.",
].join(" ");

function stripFence(s: string): string {
  const t = s.trim();
  const m = t.match(/^```[a-zA-Z]*\n?([\s\S]*?)\n?```$/);
  return (m ? m[1] : t).trim();
}

export async function runInlineCompletion(args: InlineEditArgs): Promise<string> {
  const cfg = await getConfig();
  const { model } = resolveActiveModel(cfg);
  const prompt = [
    args.context?.before ? `Context before:\n${args.context.before}\n` : "",
    `Selected text to edit:\n${args.selection}`,
    args.context?.after ? `\nContext after:\n${args.context.after}` : "",
    `\n\nInstruction: ${args.instruction}`,
  ].join("");

  const result = streamText({
    model,
    system: SYSTEM,
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
