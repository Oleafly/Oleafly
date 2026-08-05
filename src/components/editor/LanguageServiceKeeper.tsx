import { useEffect, useRef } from "react";
import {
  LanguageServiceController,
  type LanguageServiceProjectSnapshot,
} from "@/lib/analysis/language-service-controller";
import { registerLanguageServiceLifecycleActions } from "@/lib/analysis/language-service-actions";
import { resolveEffectiveMainDoc } from "@/lib/tex-root";
import { useFilesStore } from "@/store/files";
import { useIndexStore } from "@/store/project-index";

export interface LanguageServiceKeeperController {
  update(snapshot: LanguageServiceProjectSnapshot): void;
  dispose(): Promise<void> | void;
  retry?(): void;
  setup?(): Promise<void> | void;
}

export interface LanguageServiceKeeperProps {
  controller?: LanguageServiceKeeperController;
  createController?: () => LanguageServiceKeeperController;
}

export const LANGUAGE_SERVICE_DISPOSE_DIAGNOSTIC =
  "Language-service cleanup failed during runtime disposal.";

async function disposeKeeper(
  keeper: LanguageServiceKeeperController,
): Promise<void> {
  try {
    await keeper.dispose();
  } catch {
    // Keep the diagnostic stable and intentionally omit the backend error:
    // native failures can contain filesystem paths or signed download URLs.
    console.error(LANGUAGE_SERVICE_DISPOSE_DIAGNOSTIC);
  }
}

function currentProjectSnapshot(): LanguageServiceProjectSnapshot {
  const files = useFilesStore.getState();
  const index = useIndexStore.getState();
  return {
    projectId: files.projectId,
    // Language tooling follows the source format, not the compiler: a latexmk
    // project ("latexmk" id, "latex" source_format) still wants texlab.
    engineId: files.engine.source_format,
    engineLoaded: files.engineLoaded,
    // The effective main document: an active-file `% !TEX root` override wins
    // over the stored main doc. The snapshot comparison sees it as a plain
    // string, so tab switches that change the effective root re-publish.
    mainDoc: resolveEffectiveMainDoc().mainDoc,
    tree: files.tree,
    files: files.files,
    indexTexts: index.texts,
    index: index.index,
    indexBuilding: index.building,
  };
}

function sameSnapshotInputs(
  left: LanguageServiceProjectSnapshot,
  right: LanguageServiceProjectSnapshot,
): boolean {
  return (
    left.projectId === right.projectId &&
    left.engineId === right.engineId &&
    left.engineLoaded === right.engineLoaded &&
    left.mainDoc === right.mainDoc &&
    left.tree === right.tree &&
    left.files === right.files &&
    left.indexTexts === right.indexTexts &&
    left.index === right.index &&
    left.indexBuilding === right.indexBuilding
  );
}

/**
 * Owns one project language-service controller for the application lifetime.
 * Zustand subscriptions let it observe background buffers and tree refreshes
 * without subscribing the visible App tree to high-frequency editor changes.
 */
export function LanguageServiceKeeper({
  controller,
  createController,
}: LanguageServiceKeeperProps = {}) {
  const controllerRef = useRef<LanguageServiceKeeperController | null>(
    null,
  );
  const mountGeneration = useRef(0);
  if (!controllerRef.current) {
    controllerRef.current =
      controller ??
      createController?.() ??
      new LanguageServiceController();
  }
  const keeper = controllerRef.current;

  useEffect(() => {
    const generation = ++mountGeneration.current;
    const unregisterActions =
      keeper.retry && keeper.setup
        ? registerLanguageServiceLifecycleActions({
            retry: () => keeper.retry?.(),
            setup: () => keeper.setup?.(),
          })
        : () => {};
    let lastPublished: LanguageServiceProjectSnapshot | null = null;
    const publish = () => {
      const next = currentProjectSnapshot();
      if (lastPublished && sameSnapshotInputs(lastPublished, next)) {
        return;
      }
      lastPublished = next;
      keeper.update(next);
    };
    const unsubscribeFiles = useFilesStore.subscribe(publish);
    const unsubscribeIndex = useIndexStore.subscribe(publish);
    publish();
    return () => {
      unsubscribeFiles();
      unsubscribeIndex();
      unregisterActions();
      // React StrictMode immediately replays mount effects in development.
      // Deferring disposal by one microtask lets that replay retain the same
      // controller while still cleaning up promptly on a real unmount.
      queueMicrotask(() => {
        if (mountGeneration.current === generation) {
          void disposeKeeper(keeper);
        }
      });
    };
  }, [keeper]);

  return null;
}
