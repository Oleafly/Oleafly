import { Node, mergeAttributes } from "@tiptap/core";
import type { MarkdownNodeSpec } from "tiptap-markdown";

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
        state.write(String(node.attrs.source ?? ""));
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
      let currentNode = initialNode;
      let editing = false;

      const dom = document.createElement("span");
      dom.dataset.type = "raw-inline";
      dom.dataset.rawInlineEditor = "true";
      dom.contentEditable = "false";
      dom.setAttribute("aria-label", "Raw inline source");

      const source = document.createElement("code");
      source.className = "raw-inline-source";
      source.textContent = String(currentNode.attrs.source ?? "");
      dom.append(source);

      const edit = document.createElement("button");
      edit.type = "button";
      edit.className = "raw-inline-edit";
      edit.textContent = "Edit";
      edit.title = "Edit exact source";
      edit.setAttribute("aria-label", "Edit exact raw inline source");
      dom.append(edit);

      const showSource = () => {
        editing = false;
        source.textContent = String(currentNode.attrs.source ?? "");
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
        source.hidden = true;
        edit.hidden = true;

        const input = document.createElement("textarea");
        input.className = "raw-inline-input";
        input.value = String(currentNode.attrs.source ?? "");
        input.rows = Math.min(Math.max(input.value.split("\n").length, 1), 6);
        input.spellcheck = false;
        input.setAttribute("aria-label", "Exact raw inline source");

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
            view.focus();
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
            view.focus();
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
        dom.insertBefore(input, edit);
        input.focus();
        input.select();
      };

      edit.addEventListener("click", beginEditing);

      return {
        dom,
        update(nextNode) {
          if (nextNode.type !== currentNode.type) return false;
          currentNode = nextNode;
          if (!editing) source.textContent = String(nextNode.attrs.source ?? "");
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
