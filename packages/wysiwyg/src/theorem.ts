import { Node, mergeAttributes } from "@tiptap/core";
import { STANDARD_THEOREM_ENVIRONMENTS } from "./latex/theorem-environments";
import { wysiwygMessage, type WysiwygMessageKey } from "./messages";
import { createSourceEditor, updateNodeAttribute } from "./source-editing";

const STANDARD_NAMES = new Set<string>(STANDARD_THEOREM_ENVIRONMENTS);

export function theoremLabel(environment: string): string {
  const base = environment.replace(/\*$/u, "");
  if (STANDARD_NAMES.has(base)) return wysiwygMessage(`theorem.name.${base}` as WysiwygMessageKey);
  return base.charAt(0).toUpperCase() + base.slice(1);
}

function titleText(title: unknown): string {
  return typeof title === "string" && title !== "" ? `(${title})` : "";
}

export const Theorem = Node.create({
  name: "theorem",
  group: "block",
  content: "block+",
  defining: true,
  isolating: true,

  addAttributes() {
    return {
      environment: {
        default: "theorem",
        parseHTML: (element) => element.getAttribute("data-environment") ?? "theorem",
        renderHTML: (attributes) => ({ "data-environment": attributes.environment }),
      },
      title: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-title"),
        renderHTML: (attributes) => ({ "data-title": attributes.title ?? null }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'section[data-type="theorem"]', contentElement: ".theorem-body" }];
  },

  renderHTML({ HTMLAttributes, node }) {
    return [
      "section",
      mergeAttributes(HTMLAttributes, { "data-type": "theorem" }),
      [
        "header",
        { class: "theorem-header", contenteditable: "false" },
        ["span", { class: "theorem-name" }, theoremLabel(String(node.attrs.environment ?? "theorem"))],
        ["span", { class: "theorem-title" }, titleText(node.attrs.title)],
      ],
      ["div", { class: "theorem-body" }, 0],
    ];
  },

  addNodeView() {
    return ({ node: initialNode, view, getPos }) => {
      let currentNode = initialNode;
      const dom = document.createElement("section");
      dom.dataset.type = "theorem";

      const header = document.createElement("header");
      header.className = "theorem-header";
      header.setAttribute("contenteditable", "false");
      const name = document.createElement("span");
      name.className = "theorem-name";
      const title = document.createElement("span");
      title.className = "theorem-title";
      const editTitle = document.createElement("button");
      editTitle.type = "button";
      editTitle.className = "theorem-edit-title";
      editTitle.textContent = wysiwygMessage("theorem.editTitle");
      header.append(name, title, editTitle);

      const body = document.createElement("div");
      body.className = "theorem-body";
      dom.append(header, body);

      const updatePresentation = () => {
        const environment = String(currentNode.attrs.environment ?? "theorem");
        dom.dataset.environment = environment;
        name.textContent = theoremLabel(environment);
        title.textContent = titleText(currentNode.attrs.title);
      };
      updatePresentation();

      const editor = createSourceEditor({
        multiline: false,
        className: "theorem-title-input",
        label: wysiwygMessage("theorem.titleLabel"),
        placeholder: wysiwygMessage("theorem.titlePlaceholder"),
        read: () => (typeof currentNode.attrs.title === "string" ? currentNode.attrs.title : ""),
        mount: (input) => {
          title.hidden = true;
          editTitle.hidden = true;
          header.append(input);
        },
        onClose: () => {
          title.hidden = false;
          editTitle.hidden = false;
          updatePresentation();
        },
        commit: (value) => {
          updateNodeAttribute(view, getPos, currentNode.type, "title", value.trim() === "" ? null : value);
        },
        focusAfter: () => view.dom.focus({ preventScroll: true }),
      });
      editTitle.addEventListener("click", editor.open);
      title.addEventListener("click", editor.open);

      return {
        dom,
        contentDOM: body,
        update(nextNode) {
          if (nextNode.type !== currentNode.type) return false;
          currentNode = nextNode;
          if (!editor.editing) updatePresentation();
          return true;
        },
        stopEvent(event) {
          return event.target instanceof Element && header.contains(event.target);
        },
        ignoreMutation(mutation) {
          return mutation.type !== "selection" && header.contains(mutation.target);
        },
        destroy() {
          editor.close();
          editTitle.removeEventListener("click", editor.open);
          title.removeEventListener("click", editor.open);
        },
      };
    };
  },
});
