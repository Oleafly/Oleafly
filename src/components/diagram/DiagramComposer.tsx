import { useMemo } from "react";
import { generateText } from "ai";
import {
  DiagramComposer as DiagramComposerCore,
  DiagramKitContext,
  type DiagramHost,
  type DiagramKit,
} from "@openleaf/diagram";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";
import {
  compileIsolated,
  readIsolatedPdf,
  writeProjectBytes,
  writeFileContent,
  readFileContent,
  listFiles,
  createImageProject,
  getConfig,
} from "@/lib/tauri";
import { resolveActiveModel, hasConfiguredProvider } from "@/lib/ai-providers";
import { pdfPageToPng } from "@/lib/pdf-image";
import { insertAtCursor } from "@/components/editor/cm/controller";
import { editorTheme } from "@/components/editor/cm/theme";
import { latexLanguage } from "@/components/editor/cm/latex";
import { useTheme } from "@/lib/theme";
import { toast } from "@/lib/toast";
import { useFullscreen } from "@/lib/use-fullscreen";
import { isMac } from "@/lib/utils";

/** App theme -> canvas default, as a hook the package can call. */
function useThemeMode(): "light" | "dark" {
  const { theme } = useTheme();
  return theme === "dark" ? "dark" : "light";
}

const KIT: DiagramKit = {
  Button,
  Tooltip,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  toast,
  useThemeMode,
};

/** One-shot AI repair of failed TikZ; throws user-readable errors. */
async function fixWithAi(code: string, logTail: string): Promise<string> {
  const cfg = await getConfig();
  if (!hasConfiguredProvider(cfg)) {
    throw new Error("Connect an AI provider in Settings to use Fix with AI.");
  }
  const { model: aiModel } = resolveActiveModel(cfg);
  let text: string;
  try {
    ({ text } = await generateText({
      model: aiModel,
      system:
        "You fix LaTeX/TikZ figure code so it compiles under Tectonic (XeLaTeX) in a standalone document with tikz + shapes.geometric, arrows.meta, positioning, calc loaded. Return ONLY the corrected figure body: the \\begin{tikzpicture}...\\end{tikzpicture} plus any \\definecolor lines. No preamble, no \\documentclass, no explanation, no markdown code fences. Never use em dashes.",
      prompt: `This TikZ figure failed to compile. Fix it.\n\nCODE:\n${code}\n\nCOMPILE LOG (tail):\n${logTail}`,
    }));
  } catch (e) {
    throw new Error(`Fix failed: ${e}`);
  }
  return text
    .replace(/^```[a-zA-Z]*\n?/gm, "")
    .replace(/```$/gm, "")
    .trim();
}

const HOST: DiagramHost = {
  compileIsolated: (projectId, source) =>
    compileIsolated(projectId, source, useSettingsStore.getState().offline),
  readIsolatedPdf,
  pdfToPng: pdfPageToPng,
  listFiles,
  readFileContent,
  writeFileContent,
  writeProjectBytes,
  insertAtCursor,
  getMainDoc: () => useFilesStore.getState().mainDoc,
  applyExternalWrite: (path, content) =>
    useFilesStore.getState().applyExternalWrite(path, content),
  saveActive: () => useFilesStore.getState().saveActive(),
  refreshTree: () => useFilesStore.getState().refreshTree(),
  createImageProject,
  refreshProjects: () => useFilesStore.getState().refreshProjects(),
  fixWithAi,
};

/** Thin app wrapper: wires stores, Tauri, the editor, AI, and UI primitives
 *  into the package's headless composer. */
export function DiagramComposer() {
  const open = useSettingsStore((s) => s.diagramComposerOpen);
  const setOpen = useSettingsStore((s) => s.setDiagramComposerOpen);
  const projectId = useFilesStore((s) => s.projectId);
  const fullscreen = useFullscreen();
  const codeExtensions = useMemo(() => [latexLanguage(), editorTheme()], []);

  return (
    <DiagramKitContext.Provider value={KIT}>
      <DiagramComposerCore
        open={open}
        projectId={projectId}
        onClose={() => setOpen(false)}
        host={HOST}
        codeExtensions={codeExtensions}
        isMac={isMac}
        fullscreen={fullscreen}
      />
    </DiagramKitContext.Provider>
  );
}
