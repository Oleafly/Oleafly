import { useCompileStore } from "@/store/compile";
import {
  ensureAiProviderOrOpenSettings,
  handoffToAssistant,
} from "@/features/assistant-handoff";
import type { CompileError } from "@/lib/tauri";

type DetailFormatter = (error: CompileError, hintLabel: string) => string;

function errorDetail(error: CompileError, formatDetails: DetailFormatter | null): string {
  const lineSuffix = error.line == null ? "" : `:${error.line}`;
  const columnSuffix = error.line != null && error.column != null ? `:${error.column}` : "";
  const lineOnly = error.line == null ? "" : `line ${error.line}`;
  const location = error.file ? `${error.file}${lineSuffix}${columnSuffix}` : lineOnly;
  const prefix = location ? `${location}: ` : "";
  const details = formatDetails?.(error, "hint") ?? "";
  const indented = details
    .split("\n")
    .filter(Boolean)
    .map((line) => `    ${line}`);
  return [`- ${prefix}${error.message}`, ...indented].join("\n");
}

export async function askAiAboutCompileErrors() {
  if (!(await ensureAiProviderOrOpenSettings())) return;
  const errors = useCompileStore
    .getState()
    .errors.filter((error) => error.kind === "error")
    .slice(0, 8);
  const formatDetails = errors.some((error) => error.source_line != null || (error.hints?.length ?? 0) > 0)
    ? (await import("@/lib/compile-error-excerpt")).formatCompileErrorDetails
    : null;
  const details = errors.map((error) => errorDetail(error, formatDetails));
  const prompt = [
    "Fix the current document compilation failure.",
    details.length > 0 ? `\nCompiler errors:\n${details.join("\n")}` : "",
    "\nInspect the relevant project files and the full compile log, make the smallest correct changes, then recompile until it succeeds and verify the resulting document.",
  ].join("");
  handoffToAssistant(prompt, { autoSend: false });
}
