import { isolateHistory } from "@codemirror/commands";
import type { ChangeSpec, EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { emitTypstTable } from "@oleafly/conversion-registry/table";
import { typstContextAt } from "@oleafly/editor";
import { TYPST_LABEL_PATTERN } from "@oleafly/editor/typst-syntax";
import { foldLatinDiacritics } from "@oleafly/latex";
import { getEditorView, insertTemplate } from "@/components/editor/cm/controller";
import { latexGraphicsPath, suggestedFigureLabel } from "@/components/editor/figure-import";
import { ensureTypstBibliography } from "@/features/citation";
import { citationText } from "@/features/cite-insert";
import { i18n } from "@/i18n";
import { hasTypstBibliography } from "@/lib/citation/typst-bibliography";
import { citeSiteAtCaret, joinsCitation } from "@/lib/zotero/cite-syntax";
import { logError } from "@/lib/log";
import { readFileContent } from "@/lib/tauri";
import { toast } from "@/lib/toast";
import { useFilesStore } from "@/store/files";
import { useIndexStore } from "@/store/project-index";
import { sanitizeTypstLabel, typstFigureAt } from "./typst-figure";
import { matchTypstMath, typstStringLiteral } from "./typst-scan";
import {
  typstGlyphSpec,
  typstSymbolForLatex,
  typstSymbolInsertion,
  type TypstInsertContext,
} from "./typst-symbols";

export const TYPST_NUMBERING_TOAST_KEY = "typst-equation-numbering";
export const TYPST_BIBLIOGRAPHY_TOAST_KEY = "typst-bibliography";
export const TYPST_NUMBERING_RULE = '#set math.equation(numbering: "(1)")';

const LABEL_NAME = new RegExp(`^${TYPST_LABEL_PATTERN}$`, "u");
const LABEL_USE = new RegExp(`<(${TYPST_LABEL_PATTERN})>`, "gu");
const NAME_CHARACTER_BEFORE = /[\p{L}\p{M}\p{N}\p{Pc}]$/u;
const REFERENCE_CHARACTER_AFTER = /^[\p{L}\p{M}\p{N}\p{Pc}]/u;
const EQUATION_SET_RULE = /#set\s+math\.equation\s*\(/gu;
const NUMBERING_ARGUMENT = /\bnumbering\s*:/u;

function hasNumberingRule(text: string): boolean {
  EQUATION_SET_RULE.lastIndex = 0;
  for (let match = EQUATION_SET_RULE.exec(text); match; match = EQUATION_SET_RULE.exec(text)) {
    const start = match.index + match[0].length;
    const close = text.indexOf(")", start);
    if (NUMBERING_ARGUMENT.test(text.slice(start, close < 0 ? text.length : close))) return true;
    if (close < 0) return false;
    EQUATION_SET_RULE.lastIndex = close + 1;
  }
  return false;
}
const TYPST_FILE = /\.typ$/iu;

export function activeTypstVersion(): string | null {
  return useFilesStore.getState().engine.typst_resolved?.version ?? null;
}

export function contextAt(state: EditorState, pos: number): TypstInsertContext {
  return typstContextAt(state, pos);
}

interface Insertion {
  readonly insert: string;
  readonly from: number;
  readonly to: number;
}

export function dispatchInsertion(
  view: EditorView,
  insertion: Insertion,
  extra: readonly ChangeSpec[] = [],
  range: { readonly from: number; readonly to: number } = view.state.selection.main,
): void {
  const changes = view.state.changes([
    { from: range.from, to: range.to, insert: insertion.insert },
    ...extra,
  ]);
  const start = changes.mapPos(range.from, -1);
  view.dispatch({
    changes,
    selection: { anchor: start + insertion.from, head: start + insertion.to },
    annotations: isolateHistory.of("full"),
    scrollIntoView: true,
  });
  view.focus();
}

function surroundings(state: EditorState, from: number, to: number): { before: string; after: string } {
  return {
    before: state.sliceDoc(Math.max(0, from - 1), from),
    after: state.sliceDoc(to, Math.min(state.doc.length, to + 1)),
  };
}

export function typstTableTemplate(rows: number, cols: number): { template: string; selStart: number; selEnd: number } {
  const width = Math.max(1, cols);
  const grid = Array.from({ length: Math.max(1, rows) }, () => Array.from({ length: width }, () => ""));
  const body = emitTypstTable(grid, { header: true, caption: "Caption", label: "tab:label" });
  const template = `${body}\n`;
  const selStart = template.lastIndexOf("caption: [") + "caption: [".length;
  return { template, selStart, selEnd: selStart + "Caption".length };
}

export function insertTypstTableAt(rows: number, cols: number): void {
  const snippet = typstTableTemplate(rows, cols);
  insertTemplate(snippet.template, snippet.selStart, snippet.selEnd);
}

function referenceSyntaxAllowed(name: string): boolean {
  return LABEL_NAME.test(name) && !/[.:]$/u.test(name);
}

export function typstReferenceText(
  kind: "cite" | "ref",
  key: string,
  context: TypstInsertContext,
  before: string,
  after: string,
): string {
  const labelExpression = LABEL_NAME.test(key) ? `<${key}>` : `label(${typstStringLiteral(key)})`;
  if (context === "math") return `#${kind}(${labelExpression})`;
  if (context === "code") return `${kind}(${labelExpression})`;
  if (!referenceSyntaxAllowed(key)) {
    return context === "markup" ? `#${kind}(${labelExpression})` : `@${key}`;
  }
  const lead = context === "markup" && NAME_CHARACTER_BEFORE.test(before) ? " " : "";
  const trail = context === "markup" && REFERENCE_CHARACTER_AFTER.test(after) ? " " : "";
  return `${lead}@${key}${trail}`;
}

function joinCitation(view: EditorView, key: string, extra: (view: EditorView) => ChangeSpec[]): boolean {
  const { from, to } = view.state.selection.main;
  const text = view.state.doc.toString();
  const site = citeSiteAtCaret(text, from, to, "typst");
  if (!joinsCitation(site, from, to)) return false;
  const insert = citationText(text, "typst", site, key);
  dispatchInsertion(view, { insert, from: insert.length, to: insert.length }, extra(view), site);
  return true;
}

function insertReference(kind: "cite" | "ref", key: string, extra: (view: EditorView) => ChangeSpec[]): EditorView | null {
  const view = getEditorView();
  if (!view) return null;
  if (kind === "cite" && joinCitation(view, key, extra)) return view;
  const selection = view.state.selection.main;
  const { before, after } = surroundings(view.state, selection.from, selection.to);
  const text = typstReferenceText(kind, key, contextAt(view.state, selection.from), before, after);
  dispatchInsertion(view, { insert: text, from: text.length, to: text.length }, extra(view));
  return view;
}

export function insertTypstReferenceTo(label: string): void {
  insertReference("ref", label, () => []);
}

function loadedTypstSources(currentPath: string | null, currentText: string): string[] {
  const files = useFilesStore.getState();
  const texts = useIndexStore.getState().texts;
  const sources = new Map<string, string>();
  for (const [path, text] of Object.entries(texts)) if (TYPST_FILE.test(path)) sources.set(path, text);
  for (const [path, file] of Object.entries(files.files)) {
    if (TYPST_FILE.test(path) && typeof file?.content === "string") sources.set(path, file.content);
  }
  if (currentPath) sources.set(currentPath, currentText);
  return [...sources.values()];
}

export function bibliographyTargetPath(mainDoc: string | null, activePath: string | null): string | null {
  if (mainDoc && TYPST_FILE.test(mainDoc)) return mainDoc;
  return activePath;
}

function appendChange(text: string, next: string): ChangeSpec {
  const kept = text.trimEnd().length;
  return { from: kept, to: text.length, insert: next.slice(kept) };
}

async function declareBibliographyElsewhere(target: string, bibliography: string): Promise<void> {
  const files = useFilesStore.getState();
  const projectId = files.projectId;
  if (!projectId) return;
  try {
    const loaded = files.files[target]?.content;
    const current = loaded ?? (await readFileContent(projectId, target));
    const next = ensureTypstBibliography(current, latexGraphicsPath(bibliography, target));
    if (next === current || useFilesStore.getState().projectId !== projectId) return;
    if (loaded !== undefined && useFilesStore.getState().setContent(target, next)) {
      await useFilesStore.getState().saveFile(target);
    } else {
      await useFilesStore.getState().writeProjectFile(projectId, target, next);
    }
    toast.infoUnique(
      TYPST_BIBLIOGRAPHY_TOAST_KEY,
      i18n.t(($) => $.editor.typst.bibliographyAdded, { file: target }),
    );
  } catch (error) {
    void logError("typst bibliography declaration", error);
  }
}

export async function insertTypstCitation(key: string, bibliography: string | null): Promise<void> {
  const files = useFilesStore.getState();
  const activePath = files.activePath;
  const target = bibliographyTargetPath(files.mainDoc, activePath);
  let elsewhere = false;
  const view = insertReference("cite", key, (current) => {
    const text = current.state.doc.toString();
    if (!bibliography || !target) return [];
    if (loadedTypstSources(activePath, text).some(hasTypstBibliography)) return [];
    if (target !== activePath) {
      elsewhere = true;
      return [];
    }
    return [appendChange(text, ensureTypstBibliography(text, latexGraphicsPath(bibliography, target)))];
  });
  if (view && elsewhere && target && bibliography) await declareBibliographyElsewhere(target, bibliography);
}

function existingLabels(text: string): Set<string> {
  const labels = new Set<string>();
  for (const match of text.matchAll(LABEL_USE)) labels.add(match[1]);
  for (const definition of useIndexStore.getState().index?.defs ?? []) {
    if (definition.kind === "label") labels.add(definition.name);
  }
  return labels;
}

export function uniqueTypstLabel(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  for (let counter = 2; ; counter++) {
    const candidate = `${base}-${counter}`;
    if (!taken.has(candidate)) return candidate;
  }
}

function trimHyphens(text: string): string {
  let start = 0;
  let end = text.length;
  while (start < end && text[start] === "-") start += 1;
  while (end > start && text[end - 1] === "-") end -= 1;
  return text.slice(start, end);
}

function slug(text: string): string {
  return trimHyphens(foldLatinDiacritics(text).toLowerCase().replaceAll(/[^a-z0-9]+/gu, "-"));
}

export type TypstLabelPlan =
  | { readonly kind: "existing"; readonly from: number; readonly to: number }
  | { readonly kind: "insert"; readonly at: number; readonly insert: string; readonly from: number; readonly to: number };

function labelAfter(text: string, from: number): { from: number; to: number } | null {
  let index = from;
  while (text[index] === " " || text[index] === "\t") index += 1;
  const match = new RegExp(`^<(${TYPST_LABEL_PATTERN})>`, "u").exec(text.slice(index, index + 512));
  return match ? { from: index + 1, to: index + 1 + match[1].length } : null;
}

function insertPlan(at: number, name: string, leading: string): TypstLabelPlan {
  const insert = `${leading}<${name}>`;
  return { kind: "insert", at, insert, from: leading.length + 1, to: leading.length + 1 + name.length };
}

function enclosingEquation(text: string, pos: number): { from: number; to: number } | null {
  for (let index = pos - 1; index >= 0 && pos - index <= 64 * 1024; index--) {
    if (text[index] !== "$" || text[index - 1] === "\\") continue;
    const end = matchTypstMath(text, index + 1);
    if (end > pos && text[end - 1] === "$") return { from: index, to: end };
  }
  return null;
}

const HEADING_MARKER = /^([ \t]*)=+[ \t]+/u;
const LINE_TERMINATOR = /[\n\r\p{Zl}\p{Zp}]/u;

function headingParts(line: string): { indent: string; content: string } | null {
  const marker = HEADING_MARKER.exec(line);
  if (!marker) return null;
  const rest = line.slice(marker[0].length);
  if (LINE_TERMINATOR.test(rest)) return null;
  let end = rest.length;
  while (end > 0 && (rest[end - 1] === " " || rest[end - 1] === "\t")) end -= 1;
  return { indent: marker[1], content: rest.slice(0, end) };
}

function headingLabelPlan(
  text: string,
  pos: number,
  context: (pos: number) => TypstInsertContext,
  taken: ReadonlySet<string>,
): TypstLabelPlan | null {
  const lineStart = text.lastIndexOf("\n", pos - 1) + 1;
  const newline = text.indexOf("\n", pos);
  const lineEnd = newline < 0 ? text.length : newline;
  const line = text.slice(lineStart, lineEnd);
  const heading = headingParts(line);
  if (!heading || context(lineStart + heading.indent.length) !== "markup") return null;
  const contentEnd = lineStart + line.trimEnd().length;
  const existing = new RegExp(`<(${TYPST_LABEL_PATTERN})>$`, "u").exec(heading.content);
  if (existing) return { kind: "existing", from: contentEnd - 1 - existing[1].length, to: contentEnd - 1 };
  const title = slug(heading.content);
  return insertPlan(contentEnd, uniqueTypstLabel(`sec:${title || "label"}`, taken), " ");
}

export function typstLabelPlan(
  text: string,
  pos: number,
  context: (pos: number) => TypstInsertContext,
  taken: ReadonlySet<string> = new Set(),
): TypstLabelPlan {
  if (context(pos) === "math") {
    const equation = enclosingEquation(text, pos);
    if (equation) {
      const existing = labelAfter(text, equation.to);
      if (existing) return { kind: "existing", ...existing };
      return insertPlan(equation.to, uniqueTypstLabel("eq:label", taken), " ");
    }
  }
  const figure = typstFigureAt(text, pos);
  if (figure) {
    const existing = labelAfter(text, figure.callEnd);
    if (existing) return { kind: "existing", ...existing };
    let base = "fig:label";
    if (figure.body === "table") base = "tab:label";
    else if (figure.fields) base = sanitizeTypstLabel(suggestedFigureLabel(figure.fields.path));
    return insertPlan(figure.callEnd, uniqueTypstLabel(base, taken), " ");
  }
  const heading = headingLabelPlan(text, pos, context, taken);
  if (heading) return heading;
  return insertPlan(pos, uniqueTypstLabel("label", taken), "");
}

export function addTypstLabel(): void {
  const view = getEditorView();
  if (!view) return;
  const text = view.state.doc.toString();
  const pos = view.state.selection.main.head;
  const plan = typstLabelPlan(text, pos, (at) => contextAt(view.state, at), existingLabels(text));
  if (plan.kind === "existing") {
    view.dispatch({ selection: { anchor: plan.from, head: plan.to }, scrollIntoView: true });
  } else {
    view.dispatch({
      changes: { from: plan.at, insert: plan.insert },
      selection: { anchor: plan.at + plan.from, head: plan.at + plan.to },
      annotations: isolateHistory.of("full"),
      scrollIntoView: true,
    });
  }
  view.focus();
}

const offeredNumbering = new Set<string>();

export function resetTypstNumberingOffers(): void {
  offeredNumbering.clear();
}

export function typstNumberingRuleOffset(text: string): number {
  let offset = 0;
  while (offset < text.length) {
    const newline = text.indexOf("\n", offset);
    const end = newline < 0 ? text.length : newline;
    const line = text.slice(offset, end).trim();
    if (!(line.startsWith("#import") || line.startsWith("//"))) return offset;
    offset = newline < 0 ? text.length : newline + 1;
  }
  return offset;
}

export function addTypstNumberingRule(path: string | null): void {
  const view = getEditorView();
  if (!view || useFilesStore.getState().activePath !== path) return;
  const text = view.state.doc.toString();
  if (hasNumberingRule(text)) return;
  const at = typstNumberingRuleOffset(text);
  view.dispatch({
    changes: { from: at, insert: `${TYPST_NUMBERING_RULE}\n` },
    annotations: isolateHistory.of("full"),
  });
  view.focus();
}

export function insertTypstNumberedEquation(): void {
  const view = getEditorView();
  if (!view) return;
  const text = view.state.doc.toString();
  const selection = view.state.selection.main;
  const content = selection.empty ? "x" : view.state.sliceDoc(selection.from, selection.to);
  const name = uniqueTypstLabel("eq:label", existingLabels(text));
  const insert = `$ ${content} $ <${name}>`;
  dispatchInsertion(view, { insert, from: 2, to: 2 + content.length });
  const path = useFilesStore.getState().activePath;
  const key = path ?? "";
  if (offeredNumbering.has(key)) return;
  if (loadedTypstSources(path, view.state.doc.toString()).some(hasNumberingRule)) return;
  offeredNumbering.add(key);
  toast.infoUnique(TYPST_NUMBERING_TOAST_KEY, i18n.t(($) => $.editor.typst.numberingNote), {
    label: i18n.t(($) => $.editor.typst.addNumberingRule),
    onClick: () => addTypstNumberingRule(path),
  });
}

export function insertTypstSymbolFor(latex: string, glyph: string): boolean {
  const view = getEditorView();
  if (!view) return false;
  const spec = typstSymbolForLatex(latex) ?? (glyph ? typstGlyphSpec(glyph) : null);
  if (!spec) return false;
  const selection = view.state.selection.main;
  const { before, after } = surroundings(view.state, selection.from, selection.to);
  const insertion = typstSymbolInsertion(
    spec,
    contextAt(view.state, selection.from),
    activeTypstVersion(),
    before,
    after,
    glyph || undefined,
  );
  dispatchInsertion(view, insertion);
  return true;
}
