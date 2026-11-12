import {
  combineTransactionSteps,
  getChangedRanges,
  mergeAttributes,
  Node,
  type KeyboardShortcutCommand,
  type NodeViewRenderer,
} from "@tiptap/core";
import { Fragment, type Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { i18n } from "@/i18n";
import { LINE_BREAK } from "./note-blocks";
import { isSpaceOrTab } from "./note-link-format";
import type { MarkdownIt, MdCoreState, MdToken } from "./note-markdown-it";
import { redecorateTextblocks } from "./touched-textblocks";

export type CalloutTone = "blue" | "cyan" | "teal" | "green" | "yellow" | "orange" | "red" | "purple" | "gray";
export type CalloutFold = "" | "+" | "-";

export interface CalloutKind {
  id: string;
  icon: string;
  tone: CalloutTone;
}

const KIND_LIST = [
  ["note", "pencil", "blue", []],
  ["abstract", "clipboard-list", "cyan", ["summary", "tldr"]],
  ["info", "info", "blue", []],
  ["todo", "circle-check", "blue", []],
  ["tip", "flame", "cyan", ["hint", "important"]],
  ["success", "check", "green", ["check", "done"]],
  ["question", "circle-help", "yellow", ["help", "faq"]],
  ["warning", "triangle-alert", "orange", ["caution", "attention"]],
  ["failure", "x", "red", ["fail", "missing"]],
  ["danger", "zap", "red", ["error"]],
  ["bug", "bug", "red", []],
  ["example", "list", "purple", []],
  ["quote", "quote", "gray", ["cite"]],
  ["theorem", "sigma", "purple", []],
  ["lemma", "sigma", "purple", []],
  ["corollary", "sigma", "purple", []],
  ["proposition", "sigma", "purple", []],
  ["definition", "book-open", "teal", []],
  ["proof", "square-check", "gray", []],
  ["hypothesis", "lightbulb", "yellow", []],
  ["assumption", "anchor", "gray", []],
  ["result", "flask-conical", "green", []],
  ["method", "workflow", "blue", []],
  ["remark", "message-square", "gray", []],
] as const satisfies readonly (readonly [string, string, CalloutTone, readonly string[]])[];

export type CalloutType = (typeof KIND_LIST)[number][0];

const KINDS = new Map<string, CalloutKind>();
for (const [id, icon, tone, aliases] of KIND_LIST) {
  for (const name of [id, ...aliases]) KINDS.set(name, { id, icon, tone });
}

export const CALLOUT_TYPES: readonly CalloutType[] = KIND_LIST.map(([id]) => id);
const CALLOUT_START = /^\[!([A-Za-z][\w-]*)\]([+-]?)/u;
const TYPED_HEADER = /^\[!([A-Za-z][\w-]*)\]([+-]?) /u;
const DEFAULT_KIND = KINDS.get("note") as CalloutKind;
const calloutKey = new PluginKey("noteCallouts");

export function calloutKind(type: string): CalloutKind {
  return KINDS.get(type.toLowerCase()) ?? DEFAULT_KIND;
}

export function calloutLabel(type: string): string {
  const known = CALLOUT_TYPES.find((id) => id === type.toLowerCase());
  if (known) return i18n.t(($) => $.notes.kb.callouts.types[known]);
  return type ? `${type[0].toUpperCase()}${type.slice(1)}` : "";
}

export function calloutFold(value: string | null | undefined): CalloutFold {
  return value === "+" || value === "-" ? value : "";
}

function token(state: MdCoreState, type: string, tag: string, nesting: MdToken["nesting"], from: MdToken): MdToken {
  const next = new state.Token(type, tag, nesting);
  next.level = from.level;
  next.block = true;
  next.map = from.map;
  return next;
}

function titleTokens(state: MdCoreState, paragraph: MdToken, inline: MdToken, title: string): MdToken[] {
  const open = token(state, "callout_title_open", "div", 1, paragraph);
  open.attrSet("data-callout-title", "");
  const text = token(state, "inline", "", 0, inline);
  text.content = title;
  text.children = [];
  return [open, text, token(state, "callout_title_close", "div", -1, paragraph)];
}

function hasGap(paragraph: MdToken, next: MdToken): boolean {
  if (!paragraph.map || !next.map) return true;
  return next.map[0] > paragraph.map[1];
}

function readCalloutHeader(line: string): { type: string; fold: string; title: string } | null {
  const start = CALLOUT_START.exec(line);
  if (!start) return null;
  const rest = line.slice(start[0].length);
  if ((rest !== "" && !isSpaceOrTab(rest[0])) || LINE_BREAK.test(rest)) return null;
  return { type: start[1], fold: start[2], title: rest.trim() };
}

export function markCallouts(state: MdCoreState): void {
  const { tokens } = state;
  for (let index = 0; index < tokens.length; index++) {
    const quote = tokens[index];
    const paragraph = tokens[index + 1];
    const inline = tokens[index + 2];
    if (quote.type !== "blockquote_open" || paragraph?.type !== "paragraph_open" || inline?.type !== "inline") continue;
    const newline = inline.content.indexOf("\n");
    const first = newline < 0 ? inline.content : inline.content.slice(0, newline);
    const header = readCalloutHeader(first);
    if (!header) continue;
    quote.attrSet("data-callout", header.type);
    quote.attrSet("data-fold", header.fold);
    const title = titleTokens(state, paragraph, inline, header.title);
    if (newline >= 0) {
      inline.content = inline.content.slice(newline + 1);
      tokens.splice(index + 1, 0, ...title);
      continue;
    }
    const next = tokens[index + 4];
    if (next && next.type !== "blockquote_close" && hasGap(paragraph, next)) quote.attrSet("data-gap", "true");
    tokens.splice(index + 1, 3, ...title);
  }
}

const withCallouts = new WeakSet<MarkdownIt>();

function setupCallouts(md: MarkdownIt): void {
  if (withCallouts.has(md)) return;
  withCallouts.add(md);
  md.core.ruler.after("block", "note_callouts", (state) => {
    markCallouts(state);
    return true;
  });
}

interface CalloutState {
  write(text: string): void;
  ensureNewLine(): void;
  closeBlock(node: ProseMirrorNode): void;
  wrapBlock(delim: string, firstDelim: string | null, node: ProseMirrorNode, f: () => void): void;
  renderInline(parent: ProseMirrorNode, fromBlockStart?: boolean): void;
  render(node: ProseMirrorNode, parent: ProseMirrorNode, index: number): void;
}

function bodyOf(node: ProseMirrorNode): ProseMirrorNode[] {
  const body: ProseMirrorNode[] = [];
  node.forEach((child, _offset, index) => {
    if (index > 0) body.push(child);
  });
  return body;
}

function isPlaceholderBody(body: readonly ProseMirrorNode[]): boolean {
  return body.length === 0 || (body.length === 1 && body[0].type.name === "paragraph" && body[0].content.size === 0);
}

export function serializeCallout(state: CalloutState, node: ProseMirrorNode): void {
  state.wrapBlock("> ", null, node, () => {
    const title = node.child(0);
    state.write(`[!${String(node.attrs.type)}]${calloutFold(node.attrs.fold as string)}`);
    if (title.content.size > 0) {
      state.write(" ");
      state.renderInline(title, false);
    }
    const body = bodyOf(node);
    if (isPlaceholderBody(body)) return;
    if (node.attrs.gap) state.closeBlock(title);
    else state.ensureNewLine();
    body.forEach((child, index) => {
      state.render(child, node, index + 1);
    });
  });
}

export const NoteCalloutTitle = Node.create({
  name: "calloutTitle",
  content: "inline*",
  defining: true,
  selectable: false,

  parseHTML() {
    return [{ tag: "div[data-callout-title]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-callout-title": "", class: "note-callout-title" }), 0];
  },

  addStorage() {
    return { markdown: { serialize() {}, parse: {} } };
  },
});

export interface CalloutOptions {
  view: NodeViewRenderer | null;
}

function calloutAt(state: EditorState): { depth: number; node: ProseMirrorNode } | null {
  const { $from } = state.selection;
  if ($from.parent.type.name !== "calloutTitle" || $from.depth < 2) return null;
  return { depth: $from.depth - 1, node: $from.node($from.depth - 1) };
}

export function leaveCalloutTitle(state: EditorState, dispatch?: (tr: Transaction) => void): boolean {
  const found = calloutAt(state);
  if (!found) return false;
  const { $from } = state.selection;
  const start = $from.before(found.depth);
  const titleEnd = start + 1 + found.node.child(0).nodeSize;
  const first = found.node.childCount > 1 ? found.node.child(1) : null;
  const tr = state.tr;
  if (first?.type.name !== "paragraph" || first.content.size > 0) {
    tr.insert(titleEnd, state.schema.nodes.paragraph.create());
  }
  tr.setSelection(TextSelection.create(tr.doc, titleEnd + 1));
  dispatch?.(tr.scrollIntoView());
  return true;
}

export function unwrapCallout(state: EditorState, dispatch?: (tr: Transaction) => void): boolean {
  const found = calloutAt(state);
  const { selection } = state;
  if (!found || !selection.empty || selection.$from.parentOffset !== 0) return false;
  const start = selection.$from.before(found.depth);
  const title = found.node.child(0);
  const body = bodyOf(found.node);
  const blocks: ProseMirrorNode[] = [];
  if (title.content.size > 0) blocks.push(state.schema.nodes.paragraph.create(null, title.content));
  if (!(title.content.size > 0 && isPlaceholderBody(body))) blocks.push(...body);
  const quote = state.schema.nodes.blockquote.create(null, Fragment.from(blocks));
  const tr = state.tr.replaceWith(start, start + found.node.nodeSize, quote);
  tr.setSelection(TextSelection.near(tr.doc.resolve(start + 2)));
  dispatch?.(tr);
  return true;
}

function typedHeader(paragraph: ProseMirrorNode): RegExpExecArray | null {
  const text = paragraph.textBetween(0, Math.min(paragraph.content.size, 80), undefined, "￼");
  return TYPED_HEADER.exec(text);
}

function convertQuote(tr: Transaction, pos: number, quote: ProseMirrorNode, header: RegExpExecArray, cursor: number | null): void {
  const { schema } = tr.doc.type;
  const paragraph = quote.child(0);
  const length = header[0].length;
  const title = schema.nodes.calloutTitle.create(null, paragraph.content.cut(length));
  const rest = bodyOf(quote);
  const body = rest.length > 0 ? rest : [schema.nodes.paragraph.create()];
  const callout = schema.nodes.callout.create({ type: header[1], fold: header[2], gap: false }, [title, ...body]);
  tr.replaceWith(pos, pos + quote.nodeSize, callout);
  if (cursor !== null) {
    const offset = Math.max(0, Math.min(cursor - (pos + 2) - length, title.content.size));
    tr.setSelection(TextSelection.create(tr.doc, pos + 2 + offset));
  }
}

export function convertTypedCallouts(transactions: readonly Transaction[], oldState: EditorState, newState: EditorState): Transaction | null {
  if (!transactions.some((transaction) => transaction.docChanged)) return null;
  const quotes: { pos: number }[] = [];
  for (const { newRange } of getChangedRanges(combineTransactionSteps(oldState.doc, [...transactions]))) {
    newState.doc.nodesBetween(newRange.from, newRange.to, (node, pos) => {
      if (node.type.name === "blockquote" && !quotes.some((quote) => quote.pos === pos)) quotes.push({ pos });
    });
  }
  let tr: Transaction | null = null;
  const { from, empty } = newState.selection;
  quotes.sort((left, right) => right.pos - left.pos);
  for (const { pos } of quotes) {
    const node = (tr ?? newState).doc.nodeAt(pos);
    if (node?.type.name !== "blockquote" || node.firstChild?.type.name !== "paragraph") continue;
    const paragraph = node.child(0);
    const header = typedHeader(paragraph);
    if (!header) continue;
    tr ??= newState.tr;
    const cursor = tr.mapping.map(from);
    const inside = empty && cursor >= pos + 2 && cursor <= pos + 2 + paragraph.content.size;
    convertQuote(tr, pos, node, header, inside ? cursor : null);
  }
  return tr;
}

function emptyTitle(callout: ProseMirrorNode, title: ProseMirrorNode, pos: number): Decoration[] {
  if (title.type.name !== "calloutTitle" || title.content.size > 0) return [];
  return [Decoration.node(pos, pos + title.nodeSize, { class: "is-empty", "data-default": calloutLabel(String(callout.attrs.type)) })];
}

function emptyTitles(doc: ProseMirrorNode): DecorationSet {
  const found: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === "callout") found.push(...emptyTitle(node, node.child(0), pos + 1));
  });
  return DecorationSet.create(doc, found);
}

function nextTitles(tr: Transaction, previous: DecorationSet): DecorationSet {
  if (!tr.docChanged) return previous;
  const touched = redecorateTextblocks(previous, tr, (block, pos) =>
    block.type.name === "calloutTitle" ? emptyTitle(tr.doc.resolve(pos).parent, block, pos) : [],
  );
  return touched ?? emptyTitles(tr.doc);
}

export function calloutPlugin(): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: calloutKey,
    state: {
      init: (_config, state) => emptyTitles(state.doc),
      apply: nextTitles,
    },
    props: {
      decorations: (state) => calloutKey.getState(state) ?? DecorationSet.empty,
    },
    appendTransaction: convertTypedCallouts,
  });
}

export const NoteCallout = Node.create<CalloutOptions>({
  name: "callout",
  group: "block",
  content: "calloutTitle block+",
  defining: true,

  addOptions() {
    return { view: null };
  },

  addAttributes() {
    return {
      type: {
        default: "note",
        parseHTML: (element: HTMLElement) => element.dataset.callout || "note",
        renderHTML: (attributes: Record<string, unknown>) => ({ "data-callout": String(attributes.type) }),
      },
      fold: {
        default: "",
        parseHTML: (element: HTMLElement) => calloutFold(element.dataset.fold),
        renderHTML: (attributes: Record<string, unknown>) => (typeof attributes.fold === "string" && attributes.fold ? { "data-fold": attributes.fold } : {}),
      },
      gap: {
        default: false,
        parseHTML: (element: HTMLElement) => element.dataset.gap === "true",
        renderHTML: (attributes: Record<string, unknown>) => (attributes.gap ? { "data-gap": "true" } : {}),
      },
    };
  },

  parseHTML() {
    return [{ tag: "blockquote[data-callout]", priority: 60 }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["blockquote", mergeAttributes(HTMLAttributes, { class: "note-callout" }), 0];
  },

  addStorage() {
    return {
      markdown: {
        serialize: serializeCallout,
        parse: { setup: setupCallouts },
      },
    };
  },

  addKeyboardShortcuts(): Record<string, KeyboardShortcutCommand> {
    if (!this.options.view) return {};
    return {
      Enter: () => leaveCalloutTitle(this.editor.state, (tr) => this.editor.view.dispatch(tr)),
      "Shift-Enter": () => leaveCalloutTitle(this.editor.state, (tr) => this.editor.view.dispatch(tr)),
      Backspace: () => unwrapCallout(this.editor.state, (tr) => this.editor.view.dispatch(tr)),
    };
  },

  addProseMirrorPlugins() {
    return this.options.view ? [calloutPlugin()] : [];
  },

  addNodeView() {
    return this.options.view;
  },
});
