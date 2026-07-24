import { useCompileStore } from "@/store/compile";
import { useAgentHandoffStore } from "@/store/agent-handoff";
import { useSettingsStore } from "@/store/settings";
import { hasConfiguredProvider } from "@/lib/ai-providers";
import { getConfig } from "@/lib/tauri";

export async function askAiAboutCompileErrors() {
  let configured = false;
  try {
    configured = hasConfiguredProvider(await getConfig());
  } catch {
    configured = false;
  }
  const settings = useSettingsStore.getState();
  if (!configured) {
    settings.setSettingsInitialSection("ai");
    settings.setSettingsOpen(true);
    return;
  }
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
  useAgentHandoffStore.getState().handoff(prompt, { autoSend: false });
  settings.setRailTab("ai");
  if (!settings.showTree) settings.toggleTree();
}
