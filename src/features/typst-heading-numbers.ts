import { useEffect, useSyncExternalStore } from "react";
import type { AuxToc, AuxTocEntry } from "@/lib/aux-numbers";
import type { CompileSuccessCheckpoint } from "@/lib/compile-checkpoint";
import { compileOfflineForEngine } from "@/lib/document-engine";
import { createEmitter } from "@/lib/emitter";
import { logWarning } from "@/lib/log";
import { useCompileStore } from "@/store/compile";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";
import { activeTypstVariant } from "@/store/typst-variant";
import { fetchTypstDocumentInsights, type TypstInsightElement } from "./typst-insights";

const TYPST_FILE = /\.typ$/iu;

let cache: { outputId: string; toc: AuxToc } | null = null;
let requested: string | null = null;
const typstNumbersChanged = createEmitter();

export function subscribeTypstNumbers(listener: () => void): () => void {
  return typstNumbersChanged.subscribe(listener);
}

export function currentTypstToc(): AuxToc | null {
  return cache?.toc ?? null;
}

export function clearTypstNumbers(): void {
  cache = null;
  requested = null;
  typstNumbersChanged.emit();
}

function tocEntry(element: TypstInsightElement): AuxTocEntry {
  return {
    level: (element.level ?? 1) - 1,
    number: element.number,
    title: element.text,
    page: element.page === null ? null : String(element.page),
  };
}

export async function refreshTypstNumbers(checkpoint: CompileSuccessCheckpoint): Promise<void> {
  const { projectId, mainDocument, outputId } = checkpoint;
  if (!TYPST_FILE.test(mainDocument) || requested === outputId) return;
  requested = outputId;
  const { engine } = useFilesStore.getState();
  const { offline } = compileOfflineForEngine(engine, useSettingsStore.getState().offline);
  try {
    const result = await fetchTypstDocumentInsights(projectId, offline, activeTypstVariant(projectId, engine));
    if (requested !== outputId || result.status !== "ready") return;
    const entries = result.elements.filter((element) => element.kind === "heading").map(tocEntry);
    cache = { outputId, toc: { projectId, mainDocument, entries } };
    typstNumbersChanged.emit();
  } catch (error) {
    void logWarning("read the Typst heading numbers", error);
  }
}

export function useTypstToc(wanted: boolean): AuxToc | null {
  const checkpoint = useCompileStore((state) => state.lastCompileCheckpoint);
  useEffect(() => {
    if (wanted && checkpoint) void refreshTypstNumbers(checkpoint);
  }, [checkpoint, wanted]);
  return useSyncExternalStore(subscribeTypstNumbers, currentTypstToc);
}
