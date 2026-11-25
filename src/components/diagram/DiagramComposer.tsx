import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  DiagramComposer as DiagramComposerCore,
  DiagramKitContext,
  type DiagramHost,
  type DiagramKit,
  type DiagramLanguageId,
  languageForPath,
} from "@oleafly/diagram";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { closeAfterCrash } from "@/lib/close-after-crash";
import { KIT } from "@/components/diagram/diagram-kit";
import { HomeBrandButton } from "@/components/layout/HomeBrandButton";
import { WindowControls } from "@/components/layout/WindowControls";
import { confirmAction } from "@/store/confirm-dialog";
import { useFilesStore } from "@/store/files";
import { useHomeViewStore } from "@/store/home-view";
import { useSettingsStore } from "@/store/settings";
import { libraryProjects } from "@/lib/library-projects";
import { useTourStore } from "@/store/tours";
import { useDiagramComposerStore } from "@/store/diagram-composer";
import { tourRegistry } from "@/lib/tours/registry";
import {
  cancelIsolatedCompile,
  compileIsolated,
  readIsolatedPdf,
  withEventListener,
  writeProjectBytes,
  writeFileContent,
  writeBytesFile,
  listFiles,
  createImageProject,
  createDiagramProject,
  getOrCreateScratchProject,
  saveFigureToCache,
  renderTypstSnippet,
} from "@/lib/tauri";
import { renderMermaidFigure } from "@/components/diagram/mermaid-render";
import { decodeAppError, describeError } from "@/lib/app-error";
import { insertAtCursor } from "@/components/editor/cm/controller";
import { diagramCodeExtensions, diagramLanguageExtensions } from "@/components/diagram/code-extensions";
import { useFullscreen } from "@/lib/use-fullscreen";
import { isMac } from "@/lib/utils";
import { logError } from "@/lib/log";
import { pickSavePath } from "@/lib/native-file-dialog";
import { E2E_HOOKS } from "@/lib/e2e-flags";
import { sharedWriteRefusal, writeSharedText } from "@/lib/shared-document-writes";

if (typeof window !== "undefined" && E2E_HOOKS) {
  const w = window as unknown as {
    __setNextTikzImport?: (name: string | null, content: string | null) => void;
  };
  w.__setNextTikzImport = (name, content) => {
    nextTikzImportOverride = name === null ? null : { name, content: content ?? "" };
  };
}
let nextTikzImportOverride: { name: string; content: string } | null | undefined;

function pickTikzFile(accept = ".tikz,.tex"): Promise<{ name: string; content: string } | null> {
  if (E2E_HOOKS && nextTikzImportOverride !== undefined) {
    const next = nextTikzImportOverride;
    nextTikzImportOverride = undefined;
    return Promise.resolve(next);
  }
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
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

function projectLanguage(engine: string | undefined, mainDoc: string): DiagramLanguageId {
  if (engine === "typst") return "typst";
  if (engine === "markdown") return "mermaid";
  return languageForPath(mainDoc) ?? "tikz";
}

function describedWriteFailure(error: unknown): unknown {
  return decodeAppError(error) ? new Error(describeError(error)) : error;
}

function assertSharedWritable(projectId: string): void {
  const refusal = sharedWriteRefusal(projectId);
  if (refusal) throw refusal;
}

const FIGURE_LOG_EVENT = "figure:log";

const HOST: DiagramHost = {
  compileIsolated: async (projectId, source, onLog) => {
    const run = () => compileIsolated(projectId, source, useSettingsStore.getState().offline);
    try {
      return await (onLog ? withEventListener(FIGURE_LOG_EVENT, onLog, run) : run());
    } catch (error) {
      throw describedWriteFailure(error);
    }
  },
  stopCompile: async () => {
    await cancelIsolatedCompile().catch((error: unknown) => logError("stop figure compile", error));
  },
  readIsolatedPdf,
  pdfToPng: async (...args) => {
    const { pdfPageToPng } = await import("@/lib/pdf-image");
    return pdfPageToPng(...args);
  },
  listFiles,
  confirm: (message) => confirmAction({ message }),
  writeFileContent: async (projectId, path, content) => {
    assertSharedWritable(projectId);
    if (await writeSharedText(projectId, path, content)) return {};
    return writeFileContent(projectId, path, content).catch((error: unknown) => {
      throw describedWriteFailure(error);
    });
  },
  writeProjectBytes: async (projectId, relPath, dataBase64) => {
    assertSharedWritable(projectId);
    return writeProjectBytes(projectId, relPath, dataBase64).catch((error: unknown) => {
      throw describedWriteFailure(error);
    });
  },
  insertAtCursor,
  getMainDoc: () => useFilesStore.getState().mainDoc,
  applyExternalWrite: (projectId, path, content) =>
    useFilesStore.getState().applyExternalWrite(projectId, path, content),
  saveActive: () => useFilesStore.getState().saveActive(),
  refreshTree: async () => {
    await useFilesStore.getState().refreshTree();
  },
  createImageProject,
  createDiagramProject: (name, source, language) => createDiagramProject(name, source, language),
  refreshProjects: () => useFilesStore.getState().refreshProjects(),
  findProjectIdByName: async (name) => {
    await useFilesStore.getState().refreshProjects();
    return useFilesStore.getState().projects.find((p) => p.name === name)?.id ?? null;
  },
  listProjectNames: async () => {
    await useFilesStore.getState().refreshProjects();
    return libraryProjects(useFilesStore.getState().projects, useSettingsStore.getState().notes).map((p) => {
      const language = projectLanguage(p.engine, p.main_doc);
      return { id: p.id, name: p.name, typst: language === "typst", language };
    });
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
  insertTarget: () => {
    const { projectId, activePath } = useFilesStore.getState();
    const language = languageForPath(activePath);
    if (!projectId || !activePath || !language || /\.(?:tikz|mmd)$/iu.test(activePath)) return null;
    return { projectId, language };
  },
  typstContext: () => {
    const { projectId, engine } = useFilesStore.getState();
    const typst = engine.id === "typst";
    return { projectId: typst ? projectId : null, typstVersion: typst ? (engine.typst_resolved?.version ?? null) : null };
  },
  renderTypst: (request) =>
    renderTypstSnippet({
      source: request.source,
      format: request.format,
      ppi: request.ppi,
      projectId: request.projectId ?? undefined,
      document: request.document,
      offline: useSettingsStore.getState().offline,
    }),
  renderMermaid: renderMermaidFigure,
};

export function DiagramComposer() {
  const { t } = useTranslation(["diagram"]);
  const open = useHomeViewStore((s) => s.page === "diagram-composer");
  const goTo = useHomeViewStore((s) => s.goTo);
  const inProject = useFilesStore((s) => s.projectId !== null);
  const projectName = useFilesStore((s) => s.projectName);
  const requestedLanguage = useDiagramComposerStore((s) => s.language);
  const languageRequest = useDiagramComposerStore((s) => s.requestId);
  const fullscreen = useFullscreen();
  const codeExtensions = useMemo(diagramCodeExtensions, []);
  const languageExtensions = useMemo(diagramLanguageExtensions, []);

  const kit = useMemo<DiagramKit>(
    () => ({
      ...KIT,
      t: (key, params) =>
        (t as unknown as (k: string, p?: Record<string, unknown>) => string)(
          `diagram:package.${key}`,
          params,
        ),
    }),
    [t],
  );
  const [scratchId, setScratchId] = useState<string | null>(null);
  const activeTourId = useTourStore((s) => s.activeTourId);
  const activeStepIndex = useTourStore((s) => s.activeStepIndex);
  const forcePreviewOpen =
    activeTourId === "diagram" &&
    tourRegistry.diagram.steps[activeStepIndex]?.id === "diagram-preview";

  useEffect(() => {
    if (!open || scratchId) return;
    void getOrCreateScratchProject().then(setScratchId);
  }, [open, scratchId]);

  if (!open || !scratchId) return null;

  return (
    <ErrorBoundary
      fallback={null}
      resetKey={scratchId}
      onError={() => closeAfterCrash(() => useHomeViewStore.getState().goTo("library"))}
    >
      <DiagramKitContext.Provider value={kit}>
        <DiagramComposerCore
          open={open}
          projectId={scratchId}
          onClose={() => goTo("library")}
          host={HOST}
          codeExtensions={codeExtensions}
          languageExtensions={languageExtensions}
          language={requestedLanguage}
          languageRequest={languageRequest}
          isMac={isMac}
          fullscreen={fullscreen}
          forcePreviewOpen={forcePreviewOpen}
          projectName={inProject ? projectName : null}
          brand={inProject ? undefined : <HomeBrandButton onClick={() => goTo("library")} />}
          windowControls={<WindowControls />}
        />
      </DiagramKitContext.Provider>
    </ErrorBoundary>
  );
}
