import { getEditorView, insertAtCursor, replaceRange } from "@/components/editor/cm/controller";
import { isWysiwygActive } from "@/components/editor/wysiwyg/controller";
import { formattingProfileForPath } from "@/lib/document-engine";
import {
  caretCiteSite,
  citationInsert,
  citeSiteAtCaret,
  dominantLatexCommand,
  prefersBareMarkdown,
  type CiteFormat,
  type CiteSite,
} from "@/lib/zotero/cite-syntax";
import { useFilesStore } from "@/store/files";
import { latexCiteSources } from "./zotero-cite";

function activeCiteFormat(): CiteFormat | null {
  const files = useFilesStore.getState();
  const profile = formattingProfileForPath(files.engine, files.engineLoaded, files.activePath);
  if (profile === "latex" || profile === "typst" || profile === "markdown") return profile;
  return null;
}

export function citationText(doc: string, format: CiteFormat, site: CiteSite, key: string): string {
  const prose = site.kind === "prose";
  return citationInsert(format, site, key, {
    latexCommand: prose && format === "latex" ? dominantLatexCommand(latexCiteSources(doc)) : "cite",
    markdownBare:
      prose &&
      format === "markdown" &&
      !site.bracketed &&
      prefersBareMarkdown(doc.slice(0, site.from) + doc.slice(site.to)),
  });
}

export function insertCitationKey(key: string): string | null {
  const format = activeCiteFormat();
  const view = getEditorView();
  if (!format || !view) return null;
  const doc = view.state.doc.toString();
  const { from, to } = view.state.selection.main;
  const site = isWysiwygActive() ? caretCiteSite(from, to) : citeSiteAtCaret(doc, from, to, format);
  const text = citationText(doc, format, site, key);
  if (site.from === from && site.to === to) insertAtCursor(text);
  else replaceRange(site.from, site.to, text);
  return text.slice(site.separator.length);
}
