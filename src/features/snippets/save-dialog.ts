import { loadedSnippetRuntime, loadSnippetRuntime } from "@oleafly/editor";
import type { Place, ResolvedPlace, SnippetLanguage } from "@oleafly/snippets";
import { create } from "zustand";
import { getEditorView } from "@/components/editor/cm/controller";
import { useFilesStore } from "@/store/files";
import { snippetLanguageForPath } from "./language";

export interface SnippetSelection {
  text: string;
  language: SnippetLanguage | null;
  place: Place;
}

interface SaveSnippetDialogState {
  selection: SnippetSelection | null;
  close: () => void;
}

const PLACES: Readonly<Record<ResolvedPlace, Place>> = {
  text: "text",
  "inline-math": "math",
  "display-math": "math",
  code: "code",
};

export const useSaveSnippetDialog = create<SaveSnippetDialogState>((set) => ({
  selection: null,
  close: () => set({ selection: null }),
}));

function selectedText(): string {
  const view = getEditorView();
  if (!view) return "";
  const range = view.state.selection.main;
  return view.state.sliceDoc(range.from, range.to);
}

export function canSaveSelection(): boolean {
  return selectedText().trim().length > 0;
}

export function openSaveSnippet(): boolean {
  const view = getEditorView();
  const text = selectedText();
  if (!view || !text.trim()) return false;
  const language = snippetLanguageForPath(useFilesStore.getState().activePath);
  const { state } = view;
  const show = (runtime: ReturnType<typeof loadedSnippetRuntime>) => {
    const resolved = language && runtime ? runtime.snippetPlaceAt(state, state.selection.main.from, language) : null;
    useSaveSnippetDialog.setState({ selection: { text, language, place: resolved ? PLACES[resolved] : "any" } });
  };
  const runtime = loadedSnippetRuntime();
  if (runtime || !language) show(runtime);
  else loadSnippetRuntime().then(show, () => show(null));
  return true;
}
