import { mainDocumentMissing } from "@/lib/main-document";
import { mainDocumentCandidates } from "@/lib/tauri";
import { useFilesStore } from "@/store/files";
import { useOpenFolderStore } from "@/store/open-folder";
import { useSettingsStore } from "@/store/settings";

export async function chooseMainDocument(
  path: string,
  options: { readonly compile?: boolean } = {},
): Promise<boolean> {
  const files = useFilesStore.getState();
  const projectId = files.projectId;
  if (!projectId) return false;
  const wasMissing = mainDocumentMissing(files);
  await files.setMainDoc(path);
  if (useFilesStore.getState().projectId !== projectId) return false;
  useSettingsStore.getState().revealEditor();
  await useFilesStore.getState().openFile(path);
  if ((wasMissing || options.compile) && useFilesStore.getState().projectId === projectId) {
    const { useCompileStore } = await import("@/store/compile");
    const compile = useCompileStore.getState();
    if (compile.status !== "compiling") void compile.recompile({ origin: "automatic" });
  }
  return true;
}

let listing: { readonly projectId: string; readonly done: Promise<void> } | null = null;

async function presentCandidates(projectId: string): Promise<void> {
  const detection = await mainDocumentCandidates(projectId);
  const { mainDoc } = useFilesStore.getState();
  if (useFilesStore.getState().projectId !== projectId) return;
  const current = detection.candidates.some((candidate) => candidate.path === mainDoc) ? mainDoc : detection.main;
  useOpenFolderStore
    .getState()
    .present({ project_id: projectId, file: null, detection: { ...detection, decision: "ask", main: current } }, true);
}

export function changeMainDocument(): Promise<void> {
  const projectId = useFilesStore.getState().projectId;
  if (!projectId) return Promise.resolve();
  if (listing?.projectId === projectId) return listing.done;
  const done = presentCandidates(projectId).finally(() => {
    if (listing?.done === done) listing = null;
  });
  listing = { projectId, done };
  return done;
}
