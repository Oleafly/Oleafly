import { acceptCompletion, completionStatus, selectedCompletionIndex } from "@codemirror/autocomplete";
import type { EditorView } from "@codemirror/view";
import { tabCandidates } from "@oleafly/snippets";
import { vimOwnsInput } from "../latex-structure-commands";
import { insertSnippet } from "./insert";
import { fitsAt, snippetLookup } from "./lookup";
import { activeSnippetField, nextSnippetField } from "./session";

function popupWins(view: EditorView): boolean {
  if (completionStatus(view.state) !== "active") return false;
  const field = activeSnippetField(view.state);
  const listField = field?.choices !== undefined || field?.project !== undefined;
  return listField || Number(selectedCompletionIndex(view.state)) > 0;
}

export function fieldOrPopup(view: EditorView): boolean {
  if (!activeSnippetField(view.state)) return false;
  return popupWins(view) ? acceptCompletion(view) : nextSnippetField(view);
}

export function expandTabTrigger(view: EditorView): boolean {
  const state = view.state;
  if (state.readOnly || vimOwnsInput(view) || state.selection.ranges.some((range) => !range.empty)) return false;
  const head = state.selection.main.head;
  const lookup = snippetLookup(state, head);
  if (!lookup?.port.enabled().tab) return false;
  const { port } = lookup;
  const hit = tabCandidates(lookup.index, lookup.ctx, (record) => port.reportSlowRegex(record)).find((candidate) =>
    fitsAt(state, candidate.record, lookup.offset + candidate.from, lookup.language),
  );
  return hit ? insertSnippet(view, hit.record, lookup.offset + hit.from, head, "tab", hit.captures) : false;
}
