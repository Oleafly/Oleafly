import { useEffect, useMemo, useState } from "react";
import {
  DiagramComposer as DiagramComposerCore,
  DiagramKitContext,
  type DiagramHost,
} from "@oleafly/diagram";
import { KIT } from "@/components/diagram/diagram-kit";
import { HomeBrandButton } from "@/components/layout/HomeBrandButton";
import { WindowControls } from "@/components/layout/WindowControls";
import { useFilesStore } from "@/store/files";
import { useHomeViewStore } from "@/store/home-view";
import { useSettingsStore } from "@/store/settings";
import { useTourStore } from "@/store/tours";
import { tourRegistry } from "@/lib/tours/registry";
import {
  compileIsolated,
  readIsolatedPdf,
  writeProjectBytes,
  writeFileContent,
  writeBytesFile,
  listFiles,
  createImageProject,
  createDiagramProject,
  getOrCreateScratchProject,
  saveFigureToCache,
  getConfig,
} from "@/lib/tauri";
import { completeText } from "@/lib/agent-backend";
import { hasConfiguredProvider } from "@/lib/ai-providers";
import { pdfPageToPng } from "@/lib/pdf-image";
import { insertAtCursor } from "@/components/editor/cm/controller";
import { editorTheme } from "@/components/editor/cm/theme";
import { latexLanguage } from "@/components/editor/cm/latex";
import { useFullscreen } from "@/lib/use-fullscreen";
import { isMac } from "@/lib/utils";
import { pickSavePath } from "@/lib/native-file-dialog";

// E2E / devtools hook: the native bridge cannot drive a real file input, so
// specs can queue the next pick's result here instead of opening a picker
// (name: null simulates the user canceling the dialog). The real button
// click and the real applyLoadedContent() codepath still run end to end;
// only the OS file dialog itself is bypassed.
if (typeof window !== "undefined" && import.meta.env.DEV) {
  const w = window as unknown as {
    __setNextTikzImport?: (name: string | null, content: string | null) => void;
  };
  w.__setNextTikzImport = (name, content) => {
    nextTikzImportOverride = name === null ? null : { name, content: content ?? "" };
  };
}
let nextTikzImportOverride: { name: string; content: string } | null | undefined;

function pickTikzFile(): Promise<{ name: string; content: string } | null> {
  if (import.meta.env.DEV && nextTikzImportOverride !== undefined) {
    const next = nextTikzImportOverride;
    nextTikzImportOverride = undefined;
    return Promise.resolve(next);
  }
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".tikz,.tex";
    let settled = false;
    const settle = (result: { name: string; content: string } | null) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    input.addEventListener("cancel", () => settle(null));
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (!file) {
        settle(null);
        return;
      }
      file
        .text()
        .then((content) => settle({ name: file.name, content }))
        .catch(() => settle(null));
    });
    input.click();
  });
}

async function fixWithAi(code: string, logTail: string): Promise<string> {
  const cfg = await getConfig();
  if (!hasConfiguredProvider(cfg)) {
    throw new Error("Connect an AI provider in Settings to use Fix with AI.");
  }
  let text: string;
  try {
    text = await completeText({
      system:
        "You fix LaTeX/TikZ figure code so it compiles under Tectonic (XeLaTeX) in a standalone document with tikz + shapes.geometric, arrows.meta, positioning, calc, backgrounds loaded. Return ONLY the corrected figure body: the \\begin{tikzpicture}...\\end{tikzpicture} plus any \\definecolor lines. No preamble, no \\documentclass, no explanation, no markdown code fences. Never use em dashes.",
      user: `This TikZ figure failed to compile. Fix it.\n\nCODE:\n${code}\n\nCOMPILE LOG (tail):\n${logTail}`,
    });
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
  writeFileContent,
  writeProjectBytes,
  insertAtCursor,
  getMainDoc: () => useFilesStore.getState().mainDoc,
  applyExternalWrite: (projectId, path, content) =>
    useFilesStore.getState().applyExternalWrite(projectId, path, content),
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
    const dest = await pickSavePath({
      defaultPath: `${defaultName}.${extension}`,
      filters: [{ name: extension.toUpperCase(), extensions: [extension] }],
    });
    if (!dest) return false;
    await writeBytesFile(dest, dataBase64);
    return true;
  },
  pickTikzFile,
  fixWithAi,
};

// Bridges app-specific stores/Tauri/editor into the package's headless composer.
export function DiagramComposer() {
  const open = useHomeViewStore((s) => s.page === "diagram-composer");
  const goTo = useHomeViewStore((s) => s.goTo);
  const fullscreen = useFullscreen();
  const codeExtensions = useMemo(() => [latexLanguage(), editorTheme()], []);
  const [scratchId, setScratchId] = useState<string | null>(null);
  const activeTourId = useTourStore((s) => s.activeTourId);
  const activeStepIndex = useTourStore((s) => s.activeStepIndex);
  // The "Compiled preview" step opens the real preview pane and the core
  // compiles the starter drawing once (isolated; never touches user files) so
  // the step shows an actual preview instead of the empty placeholder.
  const forcePreviewOpen =
    activeTourId === "diagram" &&
    tourRegistry.diagram.steps[activeStepIndex]?.id === "diagram-preview";

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
        onClose={() => goTo("library")}
        host={HOST}
        codeExtensions={codeExtensions}
        isMac={isMac}
        fullscreen={fullscreen}
        forcePreviewOpen={forcePreviewOpen}
        brand={<HomeBrandButton onClick={() => goTo("library")} />}
        windowControls={<WindowControls />}
      />
    </DiagramKitContext.Provider>
  );
}
