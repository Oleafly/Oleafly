import { Node, mergeAttributes } from "@tiptap/core";
import { rawBlockPresentation } from "./raw-presentation";

export const RawBlock = Node.create({
  name: "rawBlock",
  group: "block",
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      source: { default: "" },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="raw-block"]' }];
  },

  renderHTML({ HTMLAttributes, node }) {
    const presentation = rawBlockPresentation(
      String(node.attrs.source ?? ""),
    );
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-type": "raw-block",
        contenteditable: "false",
      }),
      ["span", { class: "raw-block-label" }, presentation.label],
      ["span", { class: "raw-block-preview" }, presentation.preview],
    ];
  },

  addNodeView() {
    return ({ node: initialNode, view, getPos }) => {
      let currentNode = initialNode;
      let editing = false;

      const dom = document.createElement("div");
      dom.dataset.type = "raw-block";
      dom.contentEditable = "false";

      const summary = document.createElement("div");
      summary.className = "raw-block-summary";

      const copy = document.createElement("div");
      copy.className = "raw-block-copy";
      const label = document.createElement("span");
      label.className = "raw-block-label";
      const preview = document.createElement("span");
      preview.className = "raw-block-preview";
      copy.append(label, preview);

      const edit = document.createElement("button");
      edit.type = "button";
      edit.className = "raw-block-edit";
      edit.textContent = "Edit source";
      summary.append(copy, edit);
      dom.append(summary);

      const updatePresentation = () => {
        const presentation = rawBlockPresentation(
          String(currentNode.attrs.source ?? ""),
        );
        label.textContent = presentation.label;
        preview.textContent = presentation.preview;
        dom.setAttribute(
          "aria-label",
          `${presentation.label}. Exact LaTeX source preserved.`,
        );
      };
      updatePresentation();

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

      const showSummary = () => {
        editing = false;
        updatePresentation();
        summary.hidden = false;
        dom.querySelector<HTMLTextAreaElement>(".raw-block-input")?.remove();
      };

      const beginEditing = () => {
        if (editing) return;
        editing = true;
        summary.hidden = true;

        const input = document.createElement("textarea");
        input.className = "raw-block-input";
        input.value = String(currentNode.attrs.source ?? "");
        input.rows = Math.min(
          Math.max(input.value.split(/\r?\n/u).length, 3),
          14,
        );
        input.spellcheck = false;
        input.setAttribute("aria-label", "Exact LaTeX block source");

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
            showSummary();
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
            showSummary();
            view.dom.focus({ preventScroll: true });
          }
        });
        input.addEventListener(
          "blur",
          () => {
            if (!editing) return;
            updateNodeSource(input.value);
            showSummary();
          },
          { once: true },
        );
        dom.append(input);
        input.focus({ preventScroll: true });
        input.select();
      };

      edit.addEventListener("click", beginEditing);

      return {
        dom,
        update(nextNode) {
          if (nextNode.type !== currentNode.type) return false;
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
            !!target.closest(".raw-block-edit, .raw-block-input")
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
