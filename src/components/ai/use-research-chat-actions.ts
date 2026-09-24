import { useMemo } from "react";
import { i18n } from "@/i18n";
import { openBrowserWindow } from "@/lib/browser-window";
import {
  createResearchArtifactAction,
  resolveSourceUrl,
  type ProjectResearchArtifactTarget,
  type ResearchChatActions,
} from "@/lib/chat-activity";
import { logError } from "@/lib/log";
import { readResearchRootFile } from "@/lib/research-workspace";
import { toast } from "@/lib/toast";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";

export { resolveSourceUrl };

export function useResearchChatActions(projectId: string | null): ResearchChatActions {
  return useMemo(() => ({
    openSource(target) {
      const url = resolveSourceUrl(target);
      if (!url) return;
      void openBrowserWindow(url).then((opened) => {
        if (!opened) toast.error(i18n.t(($) => $.ai.research.sourceOpenFailed));
      }).catch((error: unknown) => {
        void logError("open research source", error);
        toast.error(i18n.t(($) => $.ai.research.sourceOpenFailed));
      });
    },
    openArtifact: createResearchArtifactAction(projectId, {
      inspectLinked(currentProjectId, target) {
        return readResearchRootFile(currentProjectId, target.rootId, target.relativePath);
      },
      openProject(currentProjectId, target) {
        if (useFilesStore.getState().projectId !== currentProjectId) return;
        return openProjectArtifact(currentProjectId, target);
      },
    }),
  }), [projectId]);
}

let artifactOpenSequence = 0;

function unsafeProjectPath(path: string): boolean {
  return !path || path.startsWith("/") || /^[A-Za-z]:/.test(path) || path.includes("\0") ||
    path.split("/").some((part) => part === ".." || [".git", ".private"].includes(part.toLowerCase()));
}

async function openProjectArtifact(projectId: string, target: ProjectResearchArtifactTarget): Promise<void> {
  const path = target.path.replaceAll("\\", "/");
  if (unsafeProjectPath(path)) {
    toast.error(i18n.t(($) => $.ai.research.noProjectPath));
    return;
  }
  const sequence = ++artifactOpenSequence;
  try {
    await useFilesStore.getState().openFile(path);
  } catch (error) {
    void logError("open research result", error);
    if (sequence === artifactOpenSequence) toast.error(i18n.t(($) => $.ai.research.resultOpenFailed));
    return;
  }
  const files = useFilesStore.getState();
  if (files.projectId !== projectId) return;
  if (files.activePath !== path) {
    const superseded = sequence !== artifactOpenSequence || files.files[path] !== undefined;
    if (!superseded) toast.error(i18n.t(($) => $.ai.research.resultOpenFailed));
    return;
  }
  const settings = useSettingsStore.getState();
  if (settings.viewMode === "pdf") settings.setViewMode("split");
  const line = target.line;
  if (!line || !Number.isInteger(line) || line < 1) return;
  await revealLine(projectId, path, line).catch((error: unknown) =>
    logError("reveal research result line", error),
  );
}

async function revealLine(projectId: string, path: string, line: number): Promise<void> {
  const editor = await import("@/components/editor/cm/controller");
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), 4_000);
  try {
    const ready = await editor.waitForEditorDocument(path, abort.signal);
    const current = useFilesStore.getState();
    if (ready && current.projectId === projectId && current.activePath === path) editor.gotoLine(line);
  } finally {
    clearTimeout(timeout);
  }
}
