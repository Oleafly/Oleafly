import type { EditorState } from "@codemirror/state";
import { hintCandidate, tabCandidates } from "@oleafly/snippets";
import type { GhostHint } from "../ghost-completion";
import { snippetName } from "./insert";
import { fitsAt, snippetLookup } from "./lookup";
import { activeSnippetField } from "./session";

function caret(state: EditorState): number | null {
  const { ranges, main } = state.selection;
  return ranges.length === 1 && main.empty && !state.readOnly ? main.head : null;
}

function insideActiveField(state: EditorState, pos: number): boolean {
  return activeSnippetField(state)?.ranges.some((range) => pos >= range.from && pos <= range.to) ?? false;
}

const hint: GhostHint = (state) => {
  const pos = caret(state);
  if (pos === null) return null;
  const lookup = snippetLookup(state, pos);
  if (!lookup) return null;
  const switches = lookup.port.enabled();
  if (!switches.hint || !switches.tab || insideActiveField(state, pos)) return null;
  const found = hintCandidate(lookup.index, lookup.ctx);
  if (!found || found.record.expand !== "tab") return null;
  const from = pos - found.typed.length;
  if (!fitsAt(state, found.record, from, lookup.language)) return null;
  return { pos, text: found.rest, label: snippetName(found.record), recordId: found.record.id, from };
};

export function snippetGhostHint(): GhostHint {
  return hint;
}

export function snippetHintBlocksAi(state: EditorState): boolean {
  const pos = caret(state);
  if (pos === null) return false;
  const lookup = snippetLookup(state, pos);
  if (!lookup?.port.enabled().tab) return false;
  const { port } = lookup;
  return tabCandidates(lookup.index, lookup.ctx, (record) => port.reportSlowRegex(record)).some((hit) =>
    fitsAt(state, hit.record, lookup.offset + hit.from, lookup.language),
  );
}
