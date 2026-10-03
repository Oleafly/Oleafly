import { i18n } from "@/i18n";
import { decodeAppError, describeError } from "@/lib/app-error";
import { logError } from "@/lib/log";
import { toast } from "@/lib/toast";
import { setTypstProjectOptions, type TypstOptionsUpdate } from "@/lib/typst-options";
import { typstLivePreviewWanted, useCompileStore } from "@/store/compile";
import { engineSwitchToastKey, useFilesStore } from "@/store/files";
import { useTypstVariantStore } from "@/store/typst-variant";

function compileUnlessWatched(): void {
  if (!typstLivePreviewWanted()) void useCompileStore.getState().recompile();
}

export async function applyTypstCompileOptions(update: TypstOptionsUpdate): Promise<void> {
  const projectId = useFilesStore.getState().projectId;
  if (!projectId) return;
  try {
    await setTypstProjectOptions(projectId, update);
    await useFilesStore.getState().refreshEngine();
    compileUnlessWatched();
  } catch (error) {
    void logError("save Typst compile options", error);
    const fallback =
      update.reproducible === undefined
        ? i18n.t(($) => $.shell.compile.typstFonts.saveFailed)
        : i18n.t(($) => $.shell.compile.typstBuild.saveFailed);
    toast.errorUnique(engineSwitchToastKey(projectId), decodeAppError(error) ? describeError(error) : fallback);
  }
}

export function chooseTypstVariant(variant: string | null): void {
  const projectId = useFilesStore.getState().projectId;
  if (!projectId) return;
  useTypstVariantStore.getState().select(projectId, variant);
  compileUnlessWatched();
}
