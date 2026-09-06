import { useMemo } from "react";
import { openBrowserWindow } from "@/lib/browser-window";
import {
  createResearchArtifactAction,
  safeWebUrl,
  type ProjectResearchArtifactTarget,
  type ResearchChatActions,
} from "@/lib/chat-activity";
import { readResearchRootFile } from "@/lib/research-workspace";
import { toast } from "@/lib/toast";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";

export function useResearchChatActions(projectId: string | null): ResearchChatActions {
  return useMemo(() => ({
    openSource(target) {
      const doi = target.doi?.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "");
      const url = safeWebUrl(target.url) ?? safeWebUrl(target.sourceId) ??
        (doi && /^10\.\d{4,9}\/\S+$/i.test(doi) ? `https://doi.org/${encodeURI(doi)}` : undefined) ??
        (target.sourceId && /^W\d+$/.test(target.sourceId) ? `https://openalex.org/${target.sourceId}` : undefined);
      if (!url) { toast.error("This result does not include a source link."); return; }
      void openBrowserWindow(url).then((opened) => {
        if (!opened) toast.error("The source could not be opened.");
      }).catch(() => toast.error("The source could not be opened."));
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

function openProjectArtifact(projectId: string, target: ProjectResearchArtifactTarget): Promise<void> | void {
      const path = target.path.replaceAll("\\", "/");
      if (!path || path.startsWith("/") || /^[A-Za-z]:/.test(path) || path.includes("\0") || path.split("/").some((part) => part === ".." || [".git", ".private"].includes(part.toLowerCase()))) {
        toast.error("This result does not contain a project file path.");
        return;
      }
      return useFilesStore.getState().openFile(path).then(async () => {
        const files = useFilesStore.getState();
        if (files.projectId !== projectId) return;
        if (files.activePath !== path) { toast.error("The result file could not be opened."); return; }
        const settings = useSettingsStore.getState();
        if (settings.viewMode === "pdf") settings.setViewMode("split");
        if (!target.line || !Number.isInteger(target.line) || target.line < 1) return;
        const editor = await import("@/components/editor/cm/controller");
        const abort = new AbortController();
        const timeout = setTimeout(() => abort.abort(), 4_000);
        try {
          const ready = await editor.waitForEditorDocument(path, abort.signal);
          const current = useFilesStore.getState();
          if (ready && current.projectId === projectId && current.activePath === path) editor.gotoLine(target.line);
        } finally { clearTimeout(timeout); }
      }).catch(() => {
        toast.error("The result file could not be opened.");
      });
}
