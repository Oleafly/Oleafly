import { Extension } from "@tiptap/core";
import { Heading } from "@tiptap/extension-heading";
import { Paragraph } from "@tiptap/extension-paragraph";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { MarkdownNodeSpec } from "tiptap-markdown";
import { rawBlockMarkup } from "../raw-block";
import { type TextAlign, textAlignOf } from "../text-align-values";
import { parsingMarkdownSource } from "./engine";
import { isFootnoteDefinitionStart } from "./footnote-reference";
import { escapePairedDollars, nestMarks } from "./inline-delimiters";

export { TEXT_ALIGNS, type TextAlign, textAlignOf } from "../text-align-values";

type MarkdownIt = Parameters<NonNullable<NonNullable<MarkdownNodeSpec["parse"]>["setup"]>>[0];
type BlockRule = Parameters<MarkdownIt["block"]["ruler"]["before"]>[2];
type BlockState = Parameters<BlockRule>[0];
type BlockToken = BlockState["tokens"][number];
type SerializerState = Parameters<MarkdownNodeSpec["serialize"]>[0];


declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    textAlign: {
      setTextAlign: (align: TextAlign) => ReturnType;
      unsetTextAlign: () => ReturnType;
    };
  }
}

const ALIGNED_TYPES = ["paragraph", "heading"];
const ALIGN_ATTRIBUTE = "data-text-align";
const OPEN_FENCE = /^(:{3,})[ \t]*(?:\{[ \t]*\.(left|center|right|justify)[ \t]*\}|(left|center|right|justify))[ \t]*(?::+[ \t]*)?$/u;
const CLOSE_FENCE = /^:{3,}[ \t]*$/u;
const OTHER_FENCE = /^:{3,}[ \t]*(?:\{[^{}]*\}|[^\s{}:]+)[ \t]*:*[ \t]*$/u;
const NESTED_FENCE = /^:{3,}[ \t]*[^\s:]/u;
const TEXT_BLOCK_TOKENS = new Set(["paragraph_open", "paragraph_close", "heading_open", "heading_close"]);
const NESTED_DIV_TOKENS = new Set(["align_div_open", "align_div_close"]);
const LEADING_BLOCK = "blockquote, pre, ul, ol, h1, h2, h3, h4, h5, h6, table, hr, div";
const ITEM_TYPES = new Set(["listItem", "taskItem"]);
const CALLOUT_MARKER = /^\[![\w-]+\][+-]?$/u;
const withDivs = new WeakSet<MarkdownIt>();

function lineText(state: BlockState, line: number): string {
  return state.src.slice(state.bMarks[line] + state.tShift[line], state.eMarks[line]);
}

function closingLine(state: BlockState, startLine: number, endLine: number): number | null {
  let depth = 0;
  for (let line = startLine + 1; line < endLine; line++) {
    const text = lineText(state, line);
    if (text !== "" && state.sCount[line] < state.blkIndent) return null;
    if (state.sCount[line] - state.blkIndent >= 4) continue;
    if (CLOSE_FENCE.test(text)) {
      if (depth === 0) return line;
      depth--;
    } else if (NESTED_FENCE.test(text)) {
      depth++;
    }
  }
  return null;
}

function alignedBlocks(tokens: readonly BlockToken[], level: number): BlockToken[] | null {
  const opens: BlockToken[] = [];
  let nested = false;
  for (const token of tokens) {
    if (token.level !== level) continue;
    if (NESTED_DIV_TOKENS.has(token.type)) nested = true;
    else if (!TEXT_BLOCK_TOKENS.has(token.type)) return null;
    else if (token.nesting === 1) opens.push(token);
  }
  return opens.length > 0 || nested ? opens : null;
}

function keepAsSource(state: BlockState, startLine: number, close: number): void {
  const raw = state.push("align_div_source", "div", 0);
  raw.block = true;
  raw.content = state.getLines(startLine, close + 1, state.blkIndent, false).replace(/\n$/u, "");
  raw.map = [startLine, close + 1];
}

const alignDiv: BlockRule = (state, startLine, endLine, silent) => {
  if (silent || state.sCount[startLine] - state.blkIndent >= 4) return false;
  const line = lineText(state, startLine);
  const fence = OPEN_FENCE.exec(line);
  const close = fence || OTHER_FENCE.test(line) ? closingLine(state, startLine, endLine) : null;
  if (close === null) return false;
  if (!fence) {
    if (!parsingMarkdownSource()) return false;
    keepAsSource(state, startLine, close);
    state.line = close + 1;
    return true;
  }
  const align = fence[2] ?? fence[3];
  const { lineMax, tight } = state;
  const first = state.tokens.length;
  const opener = state.push("align_div_open", "div", 1);
  opener.markup = fence[1];
  opener.info = align;
  opener.block = true;
  opener.map = [startLine, close + 1];
  state.lineMax = close;
  state.md.block.tokenize(state, startLine + 1, close);
  state.lineMax = lineMax;
  const closer = state.push("align_div_close", "div", -1);
  closer.markup = fence[1];
  closer.block = true;
  const blocks = alignedBlocks(state.tokens.slice(first + 1, -1), opener.level + 1);
  if (!blocks) {
    state.tokens.length = first;
    state.tight = tight;
    if (!parsingMarkdownSource()) {
      state.line = startLine;
      return false;
    }
    keepAsSource(state, startLine, close);
  }
  for (const block of blocks ?? []) block.attrSet(ALIGN_ATTRIBUTE, align);
  state.line = close + 1;
  return true;
};

function setupAlignDivs(md: MarkdownIt): void {
  if (withDivs.has(md)) return;
  withDivs.add(md);
  md.block.ruler.before("fence", "align_div", alignDiv);
  md.renderer.rules.align_div_open = () => "";
  md.renderer.rules.align_div_close = () => "";
  md.renderer.rules.align_div_source = (tokens, index) => rawBlockMarkup(tokens[index].content, md.utils.escapeHtml);
}

function openItemsWithParagraph(element: HTMLElement): void {
  const opened = Array.from(element.querySelectorAll("li")).flatMap((item) => {
    const first = Array.from(item.childNodes).find((child) => child.nodeType !== 3 || child.textContent?.trim());
    return first instanceof Element && first.matches(LEADING_BLOCK) ? [{ item, first }] : [];
  });
  for (const list of new Set(opened.map(({ item }) => item.parentElement))) {
    const loose = Array.from(list?.children ?? []).some((item) => Array.from(item.children).some((child) => child.localName === "p"));
    if (list && !loose) list.setAttribute("data-tight", "true");
  }
  for (const { item, first } of opened) item.insertBefore(item.ownerDocument.createElement("p"), first);
}

function opensItemWithBlock(node: ProseMirrorNode, parent: ProseMirrorNode | undefined, index: number | undefined): boolean {
  if (node.content.size > 0 || index !== 0 || !parent || !ITEM_TYPES.has(parent.type.name) || parent.childCount < 2) return false;
  return parent.child(1).type !== node.type;
}

function calloutMarkerAt(node: ProseMirrorNode, parent: ProseMirrorNode | undefined, index: number | undefined): number {
  if (index !== 0 || parent?.type.name !== "blockquote") return -1;
  let found = -1;
  node.forEach((child, _offset, at) => {
    if (found < 0 && child.type.name === "rawInline" && CALLOUT_MARKER.test(String(child.attrs.source ?? ""))) found = at;
  });
  return found;
}

function withoutChild(node: ProseMirrorNode, at: number): ProseMirrorNode {
  let offset = 0;
  for (let child = 0; child < at; child++) offset += node.child(child).nodeSize;
  return node.copy(node.content.cut(0, offset).append(node.content.cut(offset + node.child(at).nodeSize)));
}

function leadOf(node: ProseMirrorNode, parent?: ProseMirrorNode, index?: number): { lead: string; rest: ProseMirrorNode } | null {
  if (isFootnoteDefinitionStart(node)) {
    return { lead: `${String(node.child(0).attrs.source)}:`, rest: withoutChild(node, 0).cut(1) };
  }
  const at = calloutMarkerAt(node, parent, index);
  return at < 0 ? null : { lead: String(node.child(at).attrs.source), rest: withoutChild(node, at) };
}

function renderParagraph(state: SerializerState, node: ProseMirrorNode, parent?: ProseMirrorNode, index?: number): void {
  const marked = leadOf(node, parent, index);
  if (!marked) {
    state.renderInline(nestMarks(node));
    return;
  }
  const { lead, rest } = marked;
  const space = /^[ \t]*/u.exec(rest.firstChild?.isText ? (rest.firstChild.text ?? "") : "")?.[0] ?? "";
  state.write(lead);
  state.write(space || (rest.content.size > 0 ? " " : ""));
  state.renderInline(nestMarks(rest.cut(space.length)), false);
}

function aligned(body: (state: SerializerState, node: ProseMirrorNode, parent?: ProseMirrorNode, index?: number) => void): MarkdownNodeSpec["serialize"] {
  return (state, node, parent, index) => {
    if (opensItemWithBlock(node, parent, index)) return;
    const align = node.content.size > 0 ? textAlignOf(node.attrs.textAlign) : null;
    if (align) {
      state.write(`::: {.${align}}`);
      state.ensureNewLine();
    }
    const from = (state as unknown as { out: string }).out.length;
    body(state, node, parent, index);
    escapePairedDollars(state, from);
    if (align) {
      state.ensureNewLine();
      state.write(":::");
    }
    state.closeBlock(node);
  };
}

export const MarkdownParagraph = Paragraph.extend({
  addStorage() {
    const markdown: MarkdownNodeSpec = {
      serialize: aligned(renderParagraph),
      parse: { updateDOM: openItemsWithParagraph },
    };
    return { markdown };
  },
});

export const MarkdownHeading = Heading.extend({
  addStorage() {
    const markdown: MarkdownNodeSpec = {
      serialize: aligned((state, node) => {
        state.write(`${"#".repeat(Number(node.attrs.level))} `);
        state.renderInline(nestMarks(node), false);
      }),
    };
    return { markdown };
  },
});

export const TextAlignment = Extension.create({
  name: "textAlign",
  priority: 40,

  addGlobalAttributes() {
    return [
      {
        types: ALIGNED_TYPES,
        attributes: {
          textAlign: {
            default: null,
            parseHTML: (element: HTMLElement) => textAlignOf(element.getAttribute(ALIGN_ATTRIBUTE)),
            renderHTML: (attributes: Record<string, unknown>) => {
              const align = textAlignOf(attributes.textAlign);
              return align ? { [ALIGN_ATTRIBUTE]: align, style: `text-align: ${align}` } : {};
            },
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      setTextAlign:
        (align) =>
        ({ commands }) =>
          ALIGNED_TYPES.map((type) => commands.updateAttributes(type, { textAlign: align })).some(Boolean),
      unsetTextAlign:
        () =>
        ({ commands }) =>
          ALIGNED_TYPES.map((type) => commands.resetAttributes(type, "textAlign")).some(Boolean),
    };
  },

  addStorage() {
    return { markdown: { parse: { setup: setupAlignDivs } } };
  },

  onBeforeCreate() {
    const md = (this.editor.storage as unknown as Record<string, { parser?: { md?: MarkdownIt } } | undefined>).markdown?.parser?.md;
    if (md) setupAlignDivs(md);
  },
});
