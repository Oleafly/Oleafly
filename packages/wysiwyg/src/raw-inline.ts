import { Node, mergeAttributes } from "@tiptap/core";
import type { MarkdownNodeSpec } from "tiptap-markdown";
import { footnoteReferenceId, footnoteReferenceView } from "./markdown/footnote-reference";
import { parsingMarkdownSource } from "./markdown/engine";
import { keepsInlineHtml } from "./markdown/raw-html";
import { writeVerbatim } from "./markdown/table";
import { wysiwygMessage } from "./messages";
import {
  compactRawInlineSource,
  isRawMathSource,
} from "./raw-presentation";

const withRawHtml = new WeakSet<object>();
const INLINE_FORMATTING = new Set(["a", "b", "del", "em", "i", "mark", "s", "span", "strike", "strong", "sub", "sup", "u"]);
const SCRIPT_MARKERS: Readonly<Record<string, string>> = { sup: "^", sub: "~" };

function codeSpanSource(content: string): string {
  const longest = Math.max(0, ...Array.from(content.matchAll(/`+/gu), (run) => run[0].length));
  const fence = "`".repeat(longest + 1);
  return longest > 0 ? `${fence} ${content} ${fence}` : `${fence}${content}${fence}`;
}

function unmodelledSource(element: Element): string | null {
  const parent = element.parentElement?.localName ?? "";
  if (element.localName === "code") return INLINE_FORMATTING.has(parent) ? codeSpanSource(element.textContent ?? "") : null;
  const marker = SCRIPT_MARKERS[element.localName];
  const nested = parent === "sup" || parent === "sub";
  if (!marker || !nested || element.childElementCount > 0) return null;
  return `${marker}${(element.textContent ?? "").replace(/[\\`*_~^[\]<>$&]/gu, "\\$&")}${marker}`;
}

function keepUnmodelledNesting(element: HTMLElement): void {
  if (!parsingMarkdownSource()) return;
  for (const inner of element.querySelectorAll("code, sub, sup")) {
    const source = unmodelledSource(inner);
    if (source === null) continue;
    const raw = element.ownerDocument.createElement("span");
    raw.dataset.type = "raw-inline";
    raw.setAttribute("source", source);
    inner.replaceWith(raw);
  }
}

export const RawInline = Node.create({
  name: "rawInline",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      source: { default: "" },
    };
  },

  addStorage() {
    const markdown: MarkdownNodeSpec = {
      serialize(state, node) {
        writeVerbatim(state, String(node.attrs.source ?? ""));
      },
      parse: {
        setup(markdownit) {
          const render = markdownit.renderer.rules.html_inline;
          if (!render || withRawHtml.has(markdownit)) return;
          withRawHtml.add(markdownit);
          markdownit.renderer.rules.html_inline = (tokens, index, options, env, self) => {
            if (keepsInlineHtml(tokens, index)) return render(tokens, index, options, env, self);
            return `<span data-type="raw-inline" source="${markdownit.utils.escapeHtml(tokens[index].content)}"></span>`;
          };
        },
        updateDOM: keepUnmodelledNesting,
      },
    };
    return { markdown };
  },

  parseHTML() {
    return [{ tag: 'span[data-type="raw-inline"]' }];
  },

  renderHTML({ HTMLAttributes, node }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-type": "raw-inline",
        contenteditable: "false",
      }),
      node.attrs.source,
    ];
  },

  addNodeView() {
    return ({ node: initialNode, view, getPos }) => {
      const footnote = footnoteReferenceId(initialNode.attrs.source);
      if (footnote !== null) return footnoteReferenceView(initialNode, footnote);
      let currentNode = initialNode;
      let editing = false;

      const dom = document.createElement("span");
      dom.dataset.type = "raw-inline";
      dom.dataset.rawInlineEditor = "true";
      dom.contentEditable = "false";
      dom.setAttribute("aria-label", wysiwygMessage("inline.label"));

      const source = document.createElement("code");
      source.className = "raw-inline-source";
      const updatePresentation = () => {
        const exactSource = String(currentNode.attrs.source ?? "");
        if (isRawMathSource(exactSource)) {
          source.textContent = exactSource;
          source.title = wysiwygMessage("inline.mathTitle");
          dom.dataset.rawInlineKind = "math";
        } else {
          source.textContent = compactRawInlineSource(exactSource);
          source.removeAttribute("title");
          delete dom.dataset.rawInlineKind;
        }
      };
      updatePresentation();
      dom.append(source);

      const edit = document.createElement("button");
      edit.type = "button";
      edit.className = "raw-inline-edit";
      edit.textContent = wysiwygMessage("inline.edit");
      edit.title = wysiwygMessage("inline.editTitle");
      edit.setAttribute("aria-label", wysiwygMessage("inline.editLabel"));
      dom.append(edit);

      const showSource = () => {
        editing = false;
        delete dom.dataset.rawInlineEditing;
        updatePresentation();
        source.hidden = false;
        const input = dom.querySelector<HTMLTextAreaElement>(".raw-inline-input");
        input?.remove();
        edit.hidden = false;
      };

      const updateNodeSource = (nextSource: string) => {
        const position = getPos();
        if (typeof position !== "number") return;
        const liveNode = view.state.doc.nodeAt(position);
        if (!liveNode || liveNode.type !== currentNode.type) return;
        if (String(liveNode.attrs.source ?? "") === nextSource) return;
        view.dispatch(
          view.state.tr.setNodeMarkup(position, undefined, {
            ...liveNode.attrs,
            source: nextSource,
          }),
        );
      };

      const beginEditing = () => {
        if (editing) return;
        editing = true;
        dom.dataset.rawInlineEditing = "true";
        delete dom.dataset.rawInlineKind;
        source.hidden = true;
        edit.hidden = true;

        const input = document.createElement("textarea");
        input.className = "raw-inline-input";
        input.value = String(currentNode.attrs.source ?? "");
        input.rows = Math.min(Math.max(input.value.split("\n").length, 1), 6);
        input.spellcheck = false;
        input.setAttribute("aria-label", wysiwygMessage("inline.inputLabel"));

        let composing = false;
        input.addEventListener("compositionstart", () => {
          composing = true;
        });
        input.addEventListener("compositionend", () => {
          composing = false;
        });
        input.addEventListener("keydown", (event) => {
          if (event.key === "Escape" && !composing) {
            event.preventDefault();
            showSource();
            view.dom.focus({ preventScroll: true });
            return;
          }
          if (
            event.key === "Enter" &&
            (event.metaKey || event.ctrlKey) &&
            !composing
          ) {
            event.preventDefault();
            updateNodeSource(input.value);
            showSource();
            view.dom.focus({ preventScroll: true });
          }
        });
        input.addEventListener(
          "blur",
          () => {
            if (!editing) return;
            updateNodeSource(input.value);
            showSource();
          },
          { once: true },
        );
        edit.before(input);
        input.focus({ preventScroll: true });
        input.select();
      };

      edit.addEventListener("click", beginEditing);

      return {
        dom,
        update(nextNode) {
          if (nextNode.type !== currentNode.type || footnoteReferenceId(nextNode.attrs.source) !== null) return false;
          currentNode = nextNode;
          if (!editing) updatePresentation();
          return true;
        },
        selectNode() {
          dom.classList.add("ProseMirror-selectednode");
        },
        deselectNode() {
          dom.classList.remove("ProseMirror-selectednode");
        },
        stopEvent(event) {
          const target = event.target;
          return (
            target instanceof Element &&
            !!target.closest(".raw-inline-edit, .raw-inline-input")
          );
        },
        ignoreMutation(mutation) {
          return dom.contains(mutation.target);
        },
        destroy() {
          edit.removeEventListener("click", beginEditing);
        },
      };
    };
  },
});
