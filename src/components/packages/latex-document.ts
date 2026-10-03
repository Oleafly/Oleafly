import { isolateHistory } from "@codemirror/commands";
import { getEditorView } from "@/components/editor/cm/controller";
import { readDocumentSources } from "@/lib/document-sources";
import { loadedPackageNames, usepackageEdit } from "@/lib/latex-package-index";
import { readFileContent } from "@/lib/tauri";
import { resolveEffectiveMainDoc } from "@/lib/tex-root";
import { useFilesStore } from "@/store/files";
import { useIndexStore } from "@/store/project-index";

export type InsertOutcome = "editor" | "file" | "loaded" | "no-preamble";

export function latexMainDocument(): string | null {
  if (!useFilesStore.getState().projectId) return null;
  return resolveEffectiveMainDoc().mainDoc;
}

export async function documentPackages(mainDoc: string): Promise<Set<string>> {
  const projectId = useFilesStore.getState().projectId;
  if (!projectId) return new Set();
  const sources = await readDocumentSources(projectId, useIndexStore.getState().index, mainDoc);
  return loadedPackageNames(sources.texts);
}

function readMainText(projectId: string, mainDoc: string): Promise<string> {
  const files = useFilesStore.getState();
  const view = getEditorView();
  if (view && files.activePath === mainDoc) return Promise.resolve(view.state.doc.toString());
  const open = files.files[mainDoc]?.content;
  if (typeof open === "string") return Promise.resolve(open);
  return readFileContent(projectId, mainDoc);
}

export async function insertUsepackage(mainDoc: string, name: string, options: string): Promise<InsertOutcome> {
  const projectId = useFilesStore.getState().projectId;
  if (!projectId) return "no-preamble";
  const text = await readMainText(projectId, mainDoc);
  const edit = usepackageEdit(text, name, options);
  if (typeof edit === "string") return edit;
  const view = getEditorView();
  if (view && useFilesStore.getState().activePath === mainDoc && view.state.doc.toString() === text) {
    view.dispatch({ changes: edit, annotations: isolateHistory.of("full") });
    return "editor";
  }
  const next = text.slice(0, edit.from) + edit.insert + text.slice(edit.to);
  const files = useFilesStore.getState();
  if (files.files[mainDoc] !== undefined && files.setContent(mainDoc, next)) {
    await useFilesStore.getState().saveFile(mainDoc);
  } else {
    await useFilesStore.getState().writeProjectFile(projectId, mainDoc, next);
  }
  return "file";
}
