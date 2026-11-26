import { insertSnippet } from "@oleafly/editor/snippets/runtime";
import { getEditorView, insertAtCursor } from "@/components/editor/cm/controller";
import { isWysiwygActive } from "@/components/editor/wysiwyg/controller";
import { useFilesStore } from "@/store/files";
import { snippetLanguageForPath } from "./language";
import { snippetText } from "./records";
import { useSnippetStore } from "./store";

export function insertSnippetAtCursor(recordId: string): boolean {
  const record = useSnippetStore.getState().library.byId(recordId);
  if (!record) return false;
  if (isWysiwygActive()) {
    const text = snippetText(record, snippetLanguageForPath(useFilesStore.getState().activePath));
    if (!text) return false;
    insertAtCursor(text);
    return true;
  }
  const view = getEditorView();
  if (!view) return false;
  const { from, to } = view.state.selection.main;
  if (!insertSnippet(view, record, from, to, "palette")) return false;
  view.focus();
  return true;
}
