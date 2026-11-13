import { Extension } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, TextSelection, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type NodeView } from "@tiptap/pm/view";
import { wysiwygMessage } from "../messages";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    markdownFootnotes: {
      insertFootnoteReference: () => ReturnType;
    };
  }
}

const REFERENCE = /^\[\^([^\]\s[]+)\]$/u;
const DEFINITION = /^\[\^[^\]\s[]+\]:/u;
const NUMBERED = /\[\^(\d+)\]/gu;
const DEFINITION_ATTRS = { class: "text-sm text-muted-foreground", "data-footnote-definition": "" };
const LEAD_LENGTH = 300;

export function footnoteReferenceId(source: unknown): string | null {
  return REFERENCE.exec(String(source ?? ""))?.[1] ?? null;
}

export function footnoteReferenceView(node: ProseMirrorNode, id: string): NodeView {
  const dom = document.createElement("sup");
  dom.dataset.type = "footnote";
  dom.contentEditable = "false";
  dom.setAttribute("aria-label", `${wysiwygMessage("footnote.label")} ${id}`);
  const marker = document.createElement("span");
  marker.className = "px-0.5 font-bold text-primary";
  marker.textContent = id;
  dom.append(marker);
  return {
    dom,
    update: (next) => next.type === node.type && next.attrs.source === node.attrs.source,
    selectNode: () => dom.classList.add("ProseMirror-selectednode"),
    deselectNode: () => dom.classList.remove("ProseMirror-selectednode"),
    ignoreMutation: () => true,
  };
}

function sourceText(node: ProseMirrorNode): string {
  if (node.isText) return node.text ?? "";
  return node.type.name === "rawInline" ? String(node.attrs.source ?? "") : "";
}

function isDefinition(node: ProseMirrorNode): boolean {
  if (node.type.name !== "paragraph" || !node.firstChild || !sourceText(node.firstChild).startsWith("[^")) return false;
  return DEFINITION.test(node.textBetween(0, Math.min(node.content.size, LEAD_LENGTH), undefined, sourceText));
}

function definitionDecorations(doc: ProseMirrorNode): DecorationSet {
  const decorations: Decoration[] = [];
  doc.forEach((node, offset) => {
    if (isDefinition(node)) decorations.push(Decoration.node(offset, offset + node.nodeSize, DEFINITION_ATTRS));
  });
  return DecorationSet.create(doc, decorations);
}

function redecorated(tr: Transaction, decorations: DecorationSet): DecorationSet {
  let next = decorations.map(tr.mapping, tr.doc);
  const size = tr.doc.content.size;
  tr.mapping.maps.forEach((map, index) => {
    const later = tr.mapping.slice(index + 1);
    map.forEach((_oldStart, _oldEnd, newStart, newEnd) => {
      const from = Math.max(0, later.map(newStart, -1) - 1);
      const to = Math.min(size, later.map(newEnd, 1) + 1);
      tr.doc.nodesBetween(from, to, (node, pos) => {
        const end = pos + node.nodeSize;
        const stale = next.find(pos, end).filter((decoration) => decoration.from >= pos && decoration.to <= end);
        if (stale.length > 0) next = next.remove(stale);
        if (isDefinition(node)) next = next.add(tr.doc, [Decoration.node(pos, end, DEFINITION_ATTRS)]);
        return false;
      });
    });
  });
  return next;
}

function nextFootnoteNumber(doc: ProseMirrorNode): number {
  let highest = 0;
  doc.descendants((node) => {
    for (const match of sourceText(node).matchAll(NUMBERED)) highest = Math.max(highest, Number(match[1]));
  });
  return highest + 1;
}

const definitionsKey = new PluginKey<DecorationSet>("markdownFootnoteDefinitions");

export const MarkdownFootnotes = Extension.create({
  name: "markdownFootnotes",

  addCommands() {
    return {
      insertFootnoteReference:
        () =>
        ({ state, tr, dispatch }) => {
          const { rawInline, paragraph } = state.schema.nodes;
          const { $to } = state.selection;
          if (!rawInline || !paragraph || !$to.parent.canReplaceWith($to.index(), $to.index(), rawInline)) return false;
          if (!dispatch) return true;
          const reference = () => rawInline.create({ source: `[^${nextFootnoteNumber(state.doc)}]` });
          tr.insert($to.pos, reference());
          const definition = [reference(), state.schema.text(": ")];
          const last = tr.doc.lastChild;
          if (last?.type === paragraph && last.content.size === 0) tr.insert(tr.doc.content.size - 1, definition);
          else tr.insert(tr.doc.content.size, paragraph.create(null, definition));
          tr.setSelection(TextSelection.create(tr.doc, tr.doc.content.size - 1)).scrollIntoView();
          return true;
        },
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: definitionsKey,
        state: {
          init: (_config, state) => definitionDecorations(state.doc),
          apply: (tr, decorations) => (tr.docChanged ? redecorated(tr, decorations) : decorations),
        },
        props: {
          decorations: (state) => definitionsKey.getState(state),
        },
      }),
    ];
  },
});
