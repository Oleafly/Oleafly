import { invoke } from "@tauri-apps/api/core";
import type { SynctexHit, SynctexRect } from "@/lib/tauri";
import { logError } from "@/lib/log";
import { useCompileStore } from "@/store/compile";
import { useFilesStore } from "@/store/files";

export interface TypstForwardTarget {
  readonly projectId: string;
  readonly mainDoc: string;
  readonly file: string;
  readonly line: number;
  readonly column: number | null;
}

export interface TypstInverseTarget {
  readonly projectId: string;
  readonly mainDoc: string;
  readonly page: number;
  readonly x: number;
  readonly y: number;
}

function compiledTexts(): Record<string, string> {
  return { ...useCompileStore.getState().compiledSources?.texts };
}

export function typstForward(target: TypstForwardTarget): Promise<SynctexRect | null> {
  return invoke<SynctexRect | null>("typst_sync_forward", {
    request: { ...target, sources: compiledTexts() },
  });
}

export function typstInverse(target: TypstInverseTarget): Promise<SynctexHit | null> {
  return invoke<SynctexHit | null>("typst_sync_inverse", {
    request: { ...target, sources: compiledTexts() },
  });
}

let watchedProject: string | null = null;
let subscribed = false;

export function watchTypstSyncProject(projectId: string) {
  watchedProject = projectId;
  if (subscribed) return;
  subscribed = true;
  useFilesStore.subscribe((state) => {
    if (!watchedProject) return;
    if (state.projectId === watchedProject && state.engine.id === "typst") return;
    const closed = watchedProject;
    watchedProject = null;
    invoke("typst_sync_stop", { projectId: closed }).catch((error: unknown) => {
      void logError("typst sync stop", error);
    });
  });
}
