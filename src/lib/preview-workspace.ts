import { isTauri } from "@tauri-apps/api/core";
import { emitTo, listen } from "@tauri-apps/api/event";
import { useCompileStore, type CompileState, type LivePreviewState } from "@/store/compile";
import { engineSwitchToastKey, useFilesStore } from "@/store/files";
import { usePreviewDetachedStore } from "@/store/preview-detached";
import { useSettingsStore } from "@/store/settings";
import { useTourStore } from "@/store/tours";
import { i18n } from "@/i18n";
import { logError } from "@/lib/log";
import { toast } from "@/lib/toast";
import { decodeAppError, describeError } from "@/lib/app-error";
import type { TexFlavor } from "@/lib/tauri";
import { previewWindowState } from "@/lib/preview-state";
import { currentProjectStateRevision } from "@/lib/project-state-revision";
import type { PreviewWindowState } from "@/lib/preview-window";
import { mainDocumentMissing } from "@/lib/main-document";
import { folderIsRestricted, useFolderAccessStore } from "@/store/folder-access";
import { activeTypstVariant, useTypstVariantStore } from "@/store/typst-variant";
import { applyTypstCompileOptions, chooseTypstVariant } from "@/lib/typst-compile-actions";
import type { TypstOptionsUpdate } from "@/lib/typst-options";

type FileState = ReturnType<typeof useFilesStore.getState>;
export interface PreviewWorkspaceSnapshot extends
  Pick<CompileState, "status" | "log" | "errors" | "diagnostics" | "compileTimeMs" |
    "autoCompile" | "compileMode" | "checkSyntaxBeforeCompile" | "stopOnFirstError">,
  Pick<FileState, "engine" | "engineLoaded" | "mainDoc"> {
  projectId: string;
  compileRevision: number;
  noMainDocument: boolean;
  systemTexLocked: boolean;
  typstVariant?: string | null;
  livePreview?: LivePreviewState;
  previewState?: PreviewWindowState;
}

export type PreviewWorkspaceCommand =
  | { action: "compile"; fromScratch?: boolean }
  | { action: "stop" | "ready" | "pdf-settings" | "settings" | "refresh-files" | "ask-ai" | "trust-folder" }
  | { action: "auto-compile" | "syntax-check" | "stop-on-error"; value: boolean }
  | { action: "compile-mode"; value: "normal" | "fast" }
  | { action: "engine"; engine: string; flavor?: TexFlavor | null }
  | { action: "typst-version"; version: string | null }
  | ({ action: "typst-options" } & Pick<TypstOptionsUpdate, "systemFonts" | "reproducible">)
  | { action: "typst-variant"; variant: string | null }
  | { action: "source-location"; file: string | null; line: number; column?: number };

function typstOptionsUpdate(payload: { systemFonts?: unknown; reproducible?: unknown }): TypstOptionsUpdate | null {
  if (typeof payload.systemFonts === "boolean") return { systemFonts: payload.systemFonts };
  if (typeof payload.reproducible === "boolean") return { reproducible: payload.reproducible };
  return null;
}

export function sendPreviewCommand(projectId: string, command: PreviewWorkspaceCommand): Promise<void> {
  return emitTo("main", "preview:command", { projectId, ...command });
}

/** Compile in the main window, where buffer flushes and compile serialization live. */
export async function startPreviewWorkspaceBridge(): Promise<() => void> {
  if (!isTauri()) return () => {};
  const publish = () => {
    const files = useFilesStore.getState();
    const projectId = files.projectId;
    if (!projectId || usePreviewDetachedStore.getState().projectId !== projectId) return;
    const compile = useCompileStore.getState();
    const previewState = previewWindowState(compile.status, compile.lastAttemptIdentity, compile.lastCompileCheckpoint, compile.failureReason);
    void emitTo("preview", "preview:workspace", {
      projectId, engine: files.engine, engineLoaded: files.engineLoaded, mainDoc: files.mainDoc,
      status: compile.status, log: compile.log, errors: compile.errors, diagnostics: compile.diagnostics,
      compileTimeMs: compile.compileTimeMs, compileRevision: compile.lastCompileCheckpoint?.outputRevision ?? 0,
      autoCompile: compile.autoCompile, compileMode: compile.compileMode,
      checkSyntaxBeforeCompile: compile.checkSyntaxBeforeCompile, stopOnFirstError: compile.stopOnFirstError,
      noMainDocument: mainDocumentMissing(files),
      systemTexLocked: folderIsRestricted(useFolderAccessStore.getState(), projectId),
      typstVariant: activeTypstVariant(projectId, files.engine),
      livePreview: compile.livePreview,
      previewState: previewState?.identity.projectId === projectId
        ? { ...previewState, projectStateRevision: currentProjectStateRevision() } : undefined,
    } satisfies PreviewWorkspaceSnapshot).catch(() => {});
  };
  const offRequest = await listen<PreviewWorkspaceCommand & { projectId?: string }>("preview:command", ({ payload }) => {
    const projectId = payload?.projectId;
    if (!projectId || projectId !== useFilesStore.getState().projectId) return;
    const run = async () => {
      const compile = useCompileStore.getState();
      const files = useFilesStore.getState();
      switch (payload.action) {
        case "compile":
          if (payload.fromScratch === true) await compile.recompile({ fromScratch: true });
          else await compile.recompile();
          break;
        case "stop": await compile.stopCompile(); break;
        case "ready": publish(); break;
        case "auto-compile":
          if (typeof payload.value === "boolean") compile.setAutoCompile(payload.value);
          break;
        case "syntax-check":
          if (typeof payload.value === "boolean") compile.setCheckSyntaxBeforeCompile(payload.value);
          break;
        case "stop-on-error":
          if (typeof payload.value === "boolean") compile.setStopOnFirstError(payload.value);
          break;
        case "compile-mode":
          if (payload.value === "normal" || payload.value === "fast") compile.setCompileMode(payload.value);
          break;
        case "engine":
          if (payload.engine === "xetex" || (payload.engine === "latexmk" &&
            [null, undefined, "pdflatex", "xelatex", "lualatex"].includes(payload.flavor))) {
            await files.setEngine(payload.engine, payload.flavor);
          }
          break;
        case "typst-version":
          if (payload.version === null || typeof payload.version === "string") {
            await files.setTypstVersion(payload.version);
          }
          break;
        case "typst-options": {
          const update = typstOptionsUpdate(payload);
          if (update) await applyTypstCompileOptions(update);
          break;
        }
        case "typst-variant":
          if (payload.variant === null ||
            (typeof payload.variant === "string" && files.engine.typst_options?.variants.includes(payload.variant))) {
            chooseTypstVariant(payload.variant);
          }
          break;
        case "refresh-files": await files.refreshTree(); break;
        case "trust-folder": await useFolderAccessStore.getState().grant("folder"); break;
        case "pdf-settings": {
          useSettingsStore.getState().openSettingsAt("appearance", "pdf");
          const { getCurrentWindow } = await import("@tauri-apps/api/window");
          await getCurrentWindow().setFocus();
          break;
        }
        case "settings": {
          if (useTourStore.getState().activeTourId) break;
          useSettingsStore.getState().setSettingsOpen(true);
          const { getCurrentWindow } = await import("@tauri-apps/api/window");
          await getCurrentWindow().setFocus();
          break;
        }
        case "source-location": {
          if ((payload.file !== null && typeof payload.file !== "string") || !Number.isInteger(payload.line) || payload.line < 1) break;
          const { openFileAndGotoLine } = await import("@/features/synctex");
          const column = Number.isInteger(payload.column) && (payload.column ?? 0) >= 1 ? payload.column : undefined;
          await openFileAndGotoLine(payload.file, payload.line, column);
          const { getCurrentWindow } = await import("@tauri-apps/api/window");
          await getCurrentWindow().setFocus();
          break;
        }
        case "ask-ai": {
          const { askAiAboutCompileErrors } = await import("@/features/ask-ai-compile-errors");
          await askAiAboutCompileErrors();
          const { getCurrentWindow } = await import("@tauri-apps/api/window");
          await getCurrentWindow().setFocus();
          break;
        }
      }
    };
    void run().catch((error) => {
      void logError(`preview command ${payload.action}`, error);
      if (payload.action !== "engine" && payload.action !== "typst-version") return;
      const fallback = payload.action === "engine"
        ? i18n.t(($) => $.shell.enginePicker.switchFailed)
        : i18n.t(($) => $.shell.compile.typstVersion.switchFailed);
      toast.errorUnique(
        engineSwitchToastKey(projectId),
        decodeAppError(error) ? describeError(error) : fallback,
      );
    });
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = () => {
    if (timer !== undefined) return;
    timer = setTimeout(() => { timer = undefined; publish(); }, 100);
  };
  const offCompile = useCompileStore.subscribe(schedule);
  // A fast preview can request its snapshot before the window-created event.
  const offDetached = usePreviewDetachedStore.subscribe(schedule);
  const offFiles = useFilesStore.subscribe((next, previous) => {
    if (next.engine !== previous.engine || next.engineLoaded !== previous.engineLoaded || next.mainDoc !== previous.mainDoc ||
      mainDocumentMissing(next) !== mainDocumentMissing(previous)) schedule();
  });
  const offAccess = useFolderAccessStore.subscribe((next, previous) => {
    const projectId = useFilesStore.getState().projectId;
    if (folderIsRestricted(next, projectId) !== folderIsRestricted(previous, projectId)) schedule();
  });
  const offVariant = useTypstVariantStore.subscribe(schedule);
  return () => { offRequest(); offCompile(); offDetached(); offFiles(); offAccess(); offVariant(); clearTimeout(timer); };
}
