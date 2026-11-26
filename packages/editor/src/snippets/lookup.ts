import type { EditorState } from "@codemirror/state";
import {
  type LanguageIndex,
  type MatchContext,
  placeAllows,
  type SnippetLanguage,
  type SnippetRecord,
} from "@oleafly/snippets";
import { snippetPlaceAt } from "./place";
import { type SnippetPort, snippetPort } from "./port";

export const LINE_WINDOW = 256;

const CUT_LINE = "\u0001";

export interface SnippetLookup {
  port: SnippetPort;
  language: SnippetLanguage;
  index: LanguageIndex;
  ctx: MatchContext;
  offset: number;
}

export function snippetLookup(state: EditorState, pos: number, typed = ""): SnippetLookup | null {
  const port = snippetPort(state);
  const language = port?.language() ?? null;
  if (!port || !language) return null;
  const line = state.doc.lineAt(pos);
  const start = Math.max(line.from, pos - LINE_WINDOW);
  const cut = start > line.from;
  return {
    port,
    language,
    index: port.library().forLanguage(language),
    ctx: {
      language,
      lineBefore: `${cut ? CUT_LINE : ""}${state.sliceDoc(start, pos)}${typed}`,
      typstVersion: port.typstVersion(),
    },
    offset: cut ? start - 1 : start,
  };
}

export function fitsAt(state: EditorState, record: SnippetRecord, at: number, language: SnippetLanguage): boolean {
  const place = snippetPlaceAt(state, at, language);
  return place !== null && placeAllows(record, place);
}
