import { useCompileStore } from "@/store/compile";
import {
  ensureAiProviderOrOpenSettings,
  handoffToAssistant,
} from "@/features/assistant-handoff";

export async function askAiAboutCompileErrors() {
  if (!(await ensureAiProviderOrOpenSettings())) return;
  const errors = useCompileStore.getState().errors;
  const details = errors
    .filter((error) => error.kind === "error")
    .slice(0, 8)
    .map((error) => {
      const location = error.file
        ? `${error.file}${error.line != null ? `:${error.line}` : ""}`
        : error.line != null
          ? `line ${error.line}`
          : "";
      return `- ${location ? `${location}: ` : ""}${error.message}`;
    });
  const prompt = [
    "Fix the current document compilation failure.",
    details.length > 0 ? `\nCompiler errors:\n${details.join("\n")}` : "",
    "\nInspect the relevant project files and the full compile log, make the smallest correct changes, then recompile until it succeeds and verify the resulting document.",
  ].join("");
  handoffToAssistant(prompt, { autoSend: false });
}
