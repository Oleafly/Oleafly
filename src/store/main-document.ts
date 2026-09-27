import { mainDocumentMissing } from "@/lib/main-document";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";

export async function chooseMainDocument(path: string): Promise<boolean> {
  const files = useFilesStore.getState();
  const projectId = files.projectId;
  if (!projectId) return false;
  const wasMissing = mainDocumentMissing(files);
  await files.setMainDoc(path);
  if (useFilesStore.getState().projectId !== projectId) return false;
  useSettingsStore.getState().revealEditor();
  await useFilesStore.getState().openFile(path);
  if (wasMissing && useFilesStore.getState().projectId === projectId) {
    const { useCompileStore } = await import("@/store/compile");
    const compile = useCompileStore.getState();
    if (compile.status !== "compiling") void compile.recompile({ origin: "automatic" });
  }
  return true;
}
