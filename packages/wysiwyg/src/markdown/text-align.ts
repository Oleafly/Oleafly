import { Extension } from "@tiptap/core";
import { Heading } from "@tiptap/extension-heading";
import { Paragraph } from "@tiptap/extension-paragraph";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { MarkdownNodeSpec } from "tiptap-markdown";
import { type TextAlign, textAlignOf } from "../text-align-values";

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
const NESTED_FENCE = /^:{3,}[ \t]*[^\s:]/u;
const TEXT_BLOCK_TOKENS = new Set(["paragraph_open", "paragraph_close", "heading_open", "heading_close"]);
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
  for (const token of tokens) {
    if (token.level !== level) continue;
    if (!TEXT_BLOCK_TOKENS.has(token.type)) return null;
    if (token.nesting === 1) opens.push(token);
  }
  return opens.length > 0 ? opens : null;
}

const alignDiv: BlockRule = (state, startLine, endLine, silent) => {
  if (silent || state.sCount[startLine] - state.blkIndent >= 4) return false;
  const fence = OPEN_FENCE.exec(lineText(state, startLine));
  const close = fence ? closingLine(state, startLine, endLine) : null;
  if (!fence || close === null) return false;
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
    state.line = startLine;
    state.tight = tight;
    return false;
  }
  for (const block of blocks) block.attrSet(ALIGN_ATTRIBUTE, align);
  state.line = close + 1;
  return true;
};

function setupAlignDivs(md: MarkdownIt): void {
  if (withDivs.has(md)) return;
  withDivs.add(md);
  md.block.ruler.before("fence", "align_div", alignDiv);
  md.renderer.rules.align_div_open = () => "";
  md.renderer.rules.align_div_close = () => "";
}

function aligned(body: (state: SerializerState, node: ProseMirrorNode) => void): MarkdownNodeSpec["serialize"] {
  return (state, node) => {
    const align = node.content.size > 0 ? textAlignOf(node.attrs.textAlign) : null;
    if (align) {
      state.write(`::: {.${align}}`);
      state.ensureNewLine();
    }
    body(state, node);
    if (align) {
      state.ensureNewLine();
      state.write(":::");
    }
    state.closeBlock(node);
  };
}

export const MarkdownParagraph = Paragraph.extend({
  addStorage() {
    const markdown: MarkdownNodeSpec = { serialize: aligned((state, node) => state.renderInline(node)) };
    return { markdown };
  },
});

export const MarkdownHeading = Heading.extend({
  addStorage() {
    const markdown: MarkdownNodeSpec = {
      serialize: aligned((state, node) => {
        state.write(`${"#".repeat(Number(node.attrs.level))} `);
        state.renderInline(node, false);
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
