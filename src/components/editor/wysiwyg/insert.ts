import type { JSONContent } from "@tiptap/core";
import { Fragment, type Node as ProseMirrorNode } from "@tiptap/pm/model";
import { NodeSelection, TextSelection, type EditorState } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { scanMathExpressions } from "@oleafly/editor/math-source";
import {
  createFigure,
  mathNodeJSON,
  openSelectedSourceEditor,
  parseLatexBody,
  WYSIWYG_NODE_NAMES,
  type CreateFigureOptions,
} from "@oleafly/wysiwyg";
import type { WysiwygInsertions } from "./controller";

const SOURCE_EDITED_TYPES = new Set<string>([
  WYSIWYG_NODE_NAMES.footnote,
  WYSIWYG_NODE_NAMES.mathInline,
  WYSIWYG_NODE_NAMES.mathDisplay,
]);
const CAPTIONED_TYPES = new Set<string>([WYSIWYG_NODE_NAMES.figure, WYSIWYG_NODE_NAMES.tableFloat]);
const CAPTION_TYPES = new Set<string>([WYSIWYG_NODE_NAMES.figureCaption, WYSIWYG_NODE_NAMES.tableCaption]);

export interface InlineRange {
  from: number;
  to: number;
}

export function latexMathRanges(source: string): InlineRange[] {
  return scanMathExpressions(source, { format: "latex" }).map(({ from, to }) => ({ from, to }));
}

export function parseLatexSnippet(source: string, theoremEnvironments: readonly string[]): JSONContent[] {
  return (
    parseLatexBody(source, { preservedInlineRanges: latexMathRanges(source), theoremEnvironments }).content ?? []
  );
}

function isUnderstood(blocks: JSONContent[]): boolean {
  if (blocks.length !== 1) return blocks.length > 1;
  const [block] = blocks;
  if (block.type === WYSIWYG_NODE_NAMES.rawBlock) return false;
  if (block.type !== WYSIWYG_NODE_NAMES.paragraph) return true;
  const inline = block.content ?? [];
  return inline.length > 1 || (inline.length === 1 && inline[0].type !== WYSIWYG_NODE_NAMES.rawInline);
}

export function latexToVisualContent(
  source: string,
  block: boolean,
  theoremEnvironments: readonly string[],
): JSONContent[] {
  const math = mathNodeJSON(source.trim());
  if (math) return [math];
  const blocks = parseLatexSnippet(source, theoremEnvironments);
  if (!isUnderstood(blocks)) {
    return [{ type: block ? WYSIWYG_NODE_NAMES.rawBlock : WYSIWYG_NODE_NAMES.rawInline, attrs: { source } }];
  }
  const [only] = blocks;
  if (blocks.length === 1 && only.type === WYSIWYG_NODE_NAMES.paragraph) return only.content ?? [];
  return blocks;
}

function insertionRange(state: EditorState, nodes: ProseMirrorNode[], at: number | null): InlineRange {
  const size = state.doc.content.size;
  const from = at === null ? state.selection.from : Math.max(0, Math.min(at, size));
  const to = at === null ? state.selection.to : from;
  if (from !== to || nodes.length === 0 || !nodes.every((node) => node.isBlock)) return { from, to };
  const $from = state.doc.resolve(from);
  if ($from.depth === 0 || !$from.parent.isTextblock || $from.parent.content.size > 0) return { from, to };
  return { from: $from.before(), to: $from.after() };
}

export function insertVisualContent(view: EditorView, content: JSONContent[], at: number | null = null): number {
  const { state } = view;
  const nodes = content.map((json) => state.schema.nodeFromJSON(json));
  const range = insertionRange(state, nodes, at);
  view.dispatch(state.tr.replaceWith(range.from, range.to, Fragment.from(nodes)).scrollIntoView());
  return range.from;
}

function findInserted(doc: ProseMirrorNode, typeName: string, minimum: number): number | null {
  let found: number | null = null;
  doc.descendants((node, pos) => {
    if (found !== null) return false;
    if (node.type.name === typeName && pos >= minimum) {
      found = pos;
      return false;
    }
    return true;
  });
  return found;
}

export function openInsertedNodeEditor(view: EditorView, typeName: string, from: number, block: boolean): boolean {
  const pos = findInserted(view.state.doc, typeName, block ? Math.max(0, from - 1) : from);
  if (pos === null) return false;
  view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)));
  return openSelectedSourceEditor(view, typeName);
}

function captionPosition(node: ProseMirrorNode, pos: number): number | null {
  let offset = pos + 1;
  let found: number | null = null;
  node.forEach((child) => {
    if (found === null && CAPTION_TYPES.has(child.type.name)) found = offset + 1;
    offset += child.nodeSize;
  });
  return found;
}

export function focusInsertedCaption(view: EditorView, typeName: string, from: number): boolean {
  const pos = findInserted(view.state.doc, typeName, Math.max(0, from - 1));
  const node = pos === null ? null : view.state.doc.nodeAt(pos);
  const caption = node && pos !== null ? captionPosition(node, pos) : null;
  if (caption === null) return false;
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, caption)));
  view.focus();
  return true;
}

function settleAfterInsert(view: EditorView, content: JSONContent[], from: number): void {
  const single = content.length === 1 ? (content[0].type ?? "") : "";
  if (SOURCE_EDITED_TYPES.has(single)) {
    if (openInsertedNodeEditor(view, single, from, single === WYSIWYG_NODE_NAMES.mathDisplay)) return;
  } else if (CAPTIONED_TYPES.has(single) && focusInsertedCaption(view, single, from)) {
    return;
  }
  view.focus();
}

export function insertLatexIntoVisualEditor(
  view: EditorView,
  source: string,
  block: boolean,
  theoremEnvironments: readonly string[],
): void {
  const content = latexToVisualContent(source, block, theoremEnvironments);
  const from = insertVisualContent(view, content);
  settleAfterInsert(view, content, from);
}

export function positionAfterEnclosing(state: EditorState, typeName: string): number | null {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    if ($from.node(depth).type.name === typeName) return $from.after(depth);
  }
  return null;
}

export function insertVisualFigure(view: EditorView, options: CreateFigureOptions, at: number | null = null): boolean {
  const from = insertVisualContent(view, [createFigure(options)], at);
  if (!focusInsertedCaption(view, WYSIWYG_NODE_NAMES.figure, from)) view.focus();
  return true;
}

export const visualInsertions: WysiwygInsertions = {
  insertLatex: insertLatexIntoVisualEditor,
};
