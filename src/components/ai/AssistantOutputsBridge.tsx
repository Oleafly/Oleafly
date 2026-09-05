import { useEffect, useRef } from "react";
import {
  activeAgentFileChangeTurnForProject,
  useAgentFileChangesStore,
} from "@/store/agent-file-changes";
import { useAssistantOutputsStore, type AssistantFileOpen } from "@/store/assistant-outputs";
import { useFilesStore } from "@/store/files";

export const EDITOR_BUSY_WINDOW_MS = 2000;

export function firstChangedLine(before: string, after: string): number {
  const a = before.split("\n");
  const b = after.split("\n");
  const lines = Math.max(a.length, b.length);
  for (let i = 0; i < lines; i++) {
    if ((a[i] ?? "") !== (b[i] ?? "")) return i + 1;
  }
  return 1;
}

export function editorIsBusy(
  now: number,
  lastEditorActivityAt: number,
  activeElement: Element | null,
): boolean {
  if (activeElement?.closest?.(".cm-editor")) return true;
  return now - lastEditorActivityAt < EDITOR_BUSY_WINDOW_MS;
}

export function writtenFileLine(projectId: string, path: string): number {
  const turn = activeAgentFileChangeTurnForProject(useAgentFileChangesStore.getState(), projectId);
  const change = turn?.changedFiles[path];
  if (!change || (!change.beforeContent && !change.afterContent)) return 1;
  return firstChangedLine(change.beforeContent, change.afterContent);
}

let revealsInFlight = 0;

export function revealInProgress(): boolean {
  return revealsInFlight > 0;
}

export async function revealAssistantWrite(
  open: AssistantFileOpen,
  lastEditorActivityAt: number,
): Promise<boolean> {
  if (open.reason !== "write") return false;
  if (editorIsBusy(Date.now(), lastEditorActivityAt, document.activeElement)) return false;
  const projectId = useFilesStore.getState().projectId;
  if (!projectId) return false;
  const { revealEditorLine } = await import("@/lib/ai-tools");
  revealsInFlight += 1;
  try {
    return await revealEditorLine(open.path, writtenFileLine(projectId, open.path));
  } finally {
    revealsInFlight -= 1;
  }
}

export function AssistantOutputsBridge() {
  const lastEditorActivityAt = useRef(Number.NEGATIVE_INFINITY);

  useEffect(() => {
    const mark = (event: Event) => {
      if (revealInProgress()) return;
      const target = event.target;
      if (target instanceof Element && target.closest(".cm-editor")) {
        lastEditorActivityAt.current = Date.now();
      }
    };
    document.addEventListener("focusin", mark, true);
    document.addEventListener("keydown", mark, true);
    return () => {
      document.removeEventListener("focusin", mark, true);
      document.removeEventListener("keydown", mark, true);
    };
  }, []);

  useEffect(
    () =>
      useAssistantOutputsStore.subscribe((state, previous) => {
        const open = state.fileOpen;
        if (!open || open === previous.fileOpen) return;
        void revealAssistantWrite(open, lastEditorActivityAt.current);
      }),
    [],
  );

  return null;
}
