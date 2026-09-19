import { isTauri } from "@tauri-apps/api/core";
import { emitTo, listen } from "@tauri-apps/api/event";
import { useCompileStore, type CompileState } from "@/store/compile";
import { useFilesStore } from "@/store/files";
import { usePreviewDetachedStore } from "@/store/preview-detached";
import { useSettingsStore } from "@/store/settings";
import { notifyError } from "@/lib/toast";
import type { TexFlavor } from "@/lib/tauri";

type FileState = ReturnType<typeof useFilesStore.getState>;
export interface PreviewWorkspaceSnapshot extends
  Pick<CompileState, "status" | "log" | "errors" | "diagnostics" | "compileTimeMs" |
    "autoCompile" | "compileMode" | "checkSyntaxBeforeCompile" | "stopOnFirstError">,
  Pick<FileState, "engine" | "engineLoaded" | "mainDoc"> {
  projectId: string;
  compileRevision: number;
}

export type PreviewWorkspaceCommand =
  | { action: "compile"; fromScratch?: boolean }
  | { action: "stop" | "ready" | "pdf-settings" | "refresh-files" | "ask-ai" }
  | { action: "auto-compile" | "syntax-check" | "stop-on-error"; value: boolean }
  | { action: "compile-mode"; value: "normal" | "fast" }
  | { action: "engine"; engine: string; flavor?: TexFlavor | null }
  | { action: "source-location"; file: string | null; line: number };

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
    void emitTo("preview", "preview:workspace", {
      projectId, engine: files.engine, engineLoaded: files.engineLoaded, mainDoc: files.mainDoc,
      status: compile.status, log: compile.log, errors: compile.errors, diagnostics: compile.diagnostics,
      compileTimeMs: compile.compileTimeMs, compileRevision: compile.lastCompileCheckpoint?.outputRevision ?? 0,
      autoCompile: compile.autoCompile, compileMode: compile.compileMode,
      checkSyntaxBeforeCompile: compile.checkSyntaxBeforeCompile, stopOnFirstError: compile.stopOnFirstError,
    } satisfies PreviewWorkspaceSnapshot).catch(() => {});
  };
  const offRequest = await listen<PreviewWorkspaceCommand & { projectId?: string }>("preview:command", ({ payload }) => {
    if (!payload || payload.projectId !== useFilesStore.getState().projectId) return;
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
        case "refresh-files": await files.refreshTree(); break;
        case "pdf-settings": {
          useSettingsStore.getState().openSettingsAt("appearance", "pdf");
          const { getCurrentWindow } = await import("@tauri-apps/api/window");
          await getCurrentWindow().setFocus();
          break;
        }
        case "source-location": {
          if ((payload.file !== null && typeof payload.file !== "string") || !Number.isInteger(payload.line) || payload.line < 1) break;
          const { openFileAndGotoLine } = await import("@/features/synctex");
          await openFileAndGotoLine(payload.file, payload.line);
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
    void run().catch((error) => notifyError("preview command", error));
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = () => {
    if (timer !== undefined) return;
    timer = setTimeout(() => { timer = undefined; publish(); }, 100);
  };
  const offCompile = useCompileStore.subscribe(schedule);
  const offFiles = useFilesStore.subscribe((next, previous) => {
    if (next.engine !== previous.engine || next.engineLoaded !== previous.engineLoaded || next.mainDoc !== previous.mainDoc) schedule();
  });
  return () => { offRequest(); offCompile(); offFiles(); clearTimeout(timer); };
}
