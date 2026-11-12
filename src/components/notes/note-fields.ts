import { InputRule, mergeAttributes, Node, type Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { EditorView } from "@tiptap/pm/view";
import { i18n } from "@/i18n";
import { element, iconSvg } from "./note-blocks";
import { watchEditable } from "./note-editable";
import { FIELD_AT, type FieldAttrs, fieldData, fieldDisplay, fieldSource, OPEN_BRACKET, TYPED } from "./note-field-values";
import type { MarkdownIt, MdInlineState } from "./note-markdown-it";

function fieldRule(state: MdInlineState, silent: boolean): boolean {
  if (state.src.codePointAt(state.pos) !== OPEN_BRACKET) return false;
  FIELD_AT.lastIndex = state.pos;
  const match = FIELD_AT.exec(state.src);
  if (match?.index !== state.pos || match.index + match[0].length > state.posMax) return false;
  const next = state.src[state.pos + match[0].length];
  if (next === "(" || next === "[") return false;
  if (!silent) {
    const token = state.push("note_field", "span", 0);
    token.attrSet("data-note-field", "");
    token.attrSet("data-key", match[1]);
    token.attrSet("data-value", match[2]);
  }
  state.pos += match[0].length;
  return true;
}

const withFields = new WeakSet<MarkdownIt>();

function setupFields(md: MarkdownIt): void {
  if (withFields.has(md)) return;
  withFields.add(md);
  md.inline.ruler.before("link", "note_field", fieldRule);
  md.renderer.rules.note_field = (tokens, index) => {
    const token = tokens[index];
    const escapeHtml = md.utils.escapeHtml;
    return `<span data-note-field="" data-key="${escapeHtml(token.attrGet("data-key") ?? "")}" data-value="${escapeHtml(token.attrGet("data-value") ?? "")}"></span>`;
  };
}

interface MarkdownState {
  write(text: string): void;
}

export type FieldOpener = (view: EditorView, pos: number) => void;

const openers = new WeakMap<EditorView, FieldOpener>();

export function setFieldOpener(view: EditorView, opener: FieldOpener | null): void {
  if (opener) openers.set(view, opener);
  else openers.delete(view);
}

function paintChip(dom: HTMLElement, node: ProseMirrorNode, editable: boolean): void {
  const display = fieldDisplay(node.attrs as FieldAttrs, new Date(), i18n.language);
  for (const [name, value] of Object.entries(fieldData(display))) {
    if (value === undefined) dom.removeAttribute(name);
    else dom.setAttribute(name, value);
  }
  dom.setAttribute("aria-label", display.label);
  dom.dataset.tooltip = editable ? `${display.label}\n${i18n.t(($) => $.notes.fields.edit)}` : display.label;
  const key = display.icon ? iconSvg(display.icon, "note-field-icon") : element("span", "note-field-key", display.key);
  dom.replaceChildren(key, element("span", "note-field-value", display.value));
}

function fieldView(node: ProseMirrorNode, editor: Editor, getPos: () => number | undefined) {
  const dom = document.createElement("span");
  dom.className = "note-field";
  dom.contentEditable = "false";
  dom.setAttribute("role", "button");
  let current = node;
  const paint = () => paintChip(dom, current, editor.isEditable);
  paint();
  const stopWatching = watchEditable(editor, paint);
  dom.addEventListener("mousedown", (event) => {
    if (event.button !== 0 || !editor.isEditable) return;
    event.preventDefault();
    const position = getPos();
    const open = openers.get(editor.view);
    if (position !== undefined && open) open(editor.view, position);
  });
  return {
    dom,
    update(next: ProseMirrorNode) {
      if (next.type !== current.type) return false;
      current = next;
      paint();
      return true;
    },
    selectNode: () => dom.classList.add("ProseMirror-selectednode"),
    deselectNode: () => dom.classList.remove("ProseMirror-selectednode"),
    ignoreMutation: () => true,
    stopEvent: (event: Event) => event.type === "mousedown",
    destroy: stopWatching,
  };
}

export interface FieldNodeOptions {
  views: boolean;
}

export const NoteField = Node.create<FieldNodeOptions>({
  name: "noteField",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

  addOptions() {
    return { views: false };
  },

  addAttributes() {
    return {
      key: { default: "", parseHTML: (element: HTMLElement) => element.getAttribute("data-key") ?? "", renderHTML: (attributes: Record<string, unknown>) => ({ "data-key": attributes.key }) },
      value: { default: "", parseHTML: (element: HTMLElement) => element.getAttribute("data-value") ?? "", renderHTML: (attributes: Record<string, unknown>) => ({ "data-value": attributes.value }) },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-note-field]", priority: 100 }];
  },

  renderHTML({ HTMLAttributes, node }) {
    return ["span", mergeAttributes(HTMLAttributes, { "data-note-field": "", class: "note-field" }), fieldSource(node.attrs as FieldAttrs)];
  },

  renderText({ node }) {
    return fieldSource(node.attrs as FieldAttrs);
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: MarkdownState, node: ProseMirrorNode) {
          state.write(fieldSource(node.attrs as FieldAttrs));
        },
        parse: { setup: setupFields },
      },
    };
  },

  addInputRules() {
    if (!this.options.views) return [];
    return [
      new InputRule({
        find: TYPED,
        handler: ({ state, range, match }) => {
          const $from = state.doc.resolve(range.from);
          if ($from.parent.type.spec.code || $from.marks().some((mark) => mark.type.spec.code)) return null;
          state.tr.replaceWith(range.from, range.to, this.type.create({ key: match[1], value: match[2] }));
          return undefined;
        },
      }),
    ];
  },

  addNodeView() {
    if (!this.options.views) return null;
    return ({ node, editor, getPos }) => fieldView(node, editor, getPos);
  },
});
