import { useEffect, useMemo, useState } from "react";
import { generateText } from "ai";
import {
  DiagramComposer as DiagramComposerCore,
  DiagramKitContext,
  type DiagramHost,
} from "@oleafly/diagram";
import { save } from "@tauri-apps/plugin-dialog";
import { KIT } from "@/components/diagram/diagram-kit";
import { useFilesStore } from "@/store/files";
import { useHomeViewStore } from "@/store/home-view";
import { useSettingsStore } from "@/store/settings";
import {
  compileIsolated,
  readIsolatedPdf,
  writeProjectBytes,
  writeFileContent,
  readFileContent,
  writeBytesFile,
  listFiles,
  createImageProject,
  createDiagramProject,
  getOrCreateScratchProject,
  saveFigureToCache,
  getConfig,
} from "@/lib/tauri";
import { resolveActiveModel, hasConfiguredProvider } from "@/lib/ai-providers";
import { pdfPageToPng } from "@/lib/pdf-image";
import { insertAtCursor } from "@/components/editor/cm/controller";
import { editorTheme } from "@/components/editor/cm/theme";
import { latexLanguage } from "@/components/editor/cm/latex";
import { useFullscreen } from "@/lib/use-fullscreen";
import { isMac } from "@/lib/utils";

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
        "You fix LaTeX/TikZ figure code so it compiles under Tectonic (XeLaTeX) in a standalone document with tikz + shapes.geometric, arrows.meta, positioning, calc, backgrounds loaded. Return ONLY the corrected figure body: the \\begin{tikzpicture}...\\end{tikzpicture} plus any \\definecolor lines. No preamble, no \\documentclass, no explanation, no markdown code fences. Never use em dashes.",
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
  createDiagramProject,
  refreshProjects: () => useFilesStore.getState().refreshProjects(),
  findProjectIdByName: async (name) => {
    await useFilesStore.getState().refreshProjects();
    return useFilesStore.getState().projects.find((p) => p.name === name)?.id ?? null;
  },
  listProjectNames: async () => {
    await useFilesStore.getState().refreshProjects();
    return useFilesStore.getState().projects.map((p) => ({ id: p.id, name: p.name }));
  },
  saveFigureToCache: async (name, pngBase64, tikz) => {
    const r = await saveFigureToCache(name, pngBase64, tikz);
    return { hash: r.hash, alreadyCached: r.alreadyCached };
  },
  saveBytesToDisk: async (defaultName, extension, dataBase64) => {
    const dest = await save({
      defaultPath: `${defaultName}.${extension}`,
      filters: [{ name: extension.toUpperCase(), extensions: [extension] }],
    });
    if (!dest) return false;
    await writeBytesFile(dest, dataBase64);
    return true;
  },
  fixWithAi,
};

// Bridges app-specific stores/Tauri/editor into the package's headless composer.
export function DiagramComposer() {
  const open = useHomeViewStore((s) => s.page === "diagram-composer");
  const goTo = useHomeViewStore((s) => s.goTo);
  const fullscreen = useFullscreen();
  const codeExtensions = useMemo(() => [latexLanguage(), editorTheme()], []);
  const [scratchId, setScratchId] = useState<string | null>(null);

  useEffect(() => {
    if (!open || scratchId) return;
    void getOrCreateScratchProject().then(setScratchId);
  }, [open, scratchId]);

  if (!open || !scratchId) return null;

  return (
    <DiagramKitContext.Provider value={KIT}>
      <DiagramComposerCore
        open={open}
        projectId={scratchId}
        projectName="Diagram Composer"
        onClose={() => goTo("library")}
        host={HOST}
        codeExtensions={codeExtensions}
        isMac={isMac}
        fullscreen={fullscreen}
      />
    </DiagramKitContext.Provider>
  );
}
