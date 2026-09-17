import { Extension, Node, mergeAttributes, type JSONContent, type NodeViewRenderer } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { booleanAttribute, stringAttribute } from "./attribute-specs";
import {
  columnsToTableSpec,
  defaultTableColumn,
  normalizeTableColumns,
  tableSpecToColumns,
  type TableColumn,
} from "./latex/table-spec";
import { wysiwygMessage } from "./messages";
import { updateNodeAttribute } from "./source-editing";

export type CaptionPosition = "above" | "below";

export interface CreateTableFloatOptions {
  header?: boolean;
}

export function createTableFloat(
  rows: number,
  cols: number,
  options: CreateTableFloatOptions = {},
): JSONContent {
  const rowCount = Math.max(1, Math.trunc(rows));
  const colCount = Math.max(1, Math.trunc(cols));
  const header = options.header ?? true;
  const rowNodes = Array.from({ length: rowCount }, (_row, index) => ({
    type: "tableRow",
    attrs: {
      borderTop: index === 0 ? "toprule" : index === 1 && header ? "midrule" : null,
      borderBottom: index === rowCount - 1 ? "bottomrule" : null,
    },
    content: Array.from({ length: colCount }, () => ({
      type: header && index === 0 ? "tableHeader" : "tableCell",
      attrs: { colspan: 1, rowspan: 1, columnSpec: null },
      content: [{ type: "paragraph" }],
    })),
  }));
  return {
    type: "tableFloat",
    attrs: {
      placement: "htbp",
      centering: true,
      label: null,
      captionPosition: "above",
      columns: Array.from({ length: colCount }, defaultTableColumn),
      floating: true,
    },
    content: [{ type: "table", content: rowNodes }],
  };
}

export const LatexTableAttributes = Extension.create({
  name: "latexTableAttributes",

  addGlobalAttributes() {
    return [
      {
        types: ["tableRow"],
        attributes: {
          borderTop: stringAttribute("borderTop", null, "border-top"),
          borderBottom: stringAttribute("borderBottom", null, "border-bottom"),
        },
      },
      {
        types: ["tableCell", "tableHeader"],
        attributes: {
          columnSpec: stringAttribute("columnSpec", null, "column-spec"),
        },
      },
    ];
  },
});

export const TableCaption = Node.create({
  name: "tableCaption",
  content: "inline*",
  defining: true,

  parseHTML() {
    return [{ tag: 'div[data-type="table-caption"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-type": "table-caption",
        "data-placeholder": wysiwygMessage("table.captionPlaceholder"),
      }),
      0,
    ];
  },
});

function tableFloatNodeView(): NodeViewRenderer {
  return ({ node: initialNode, view, getPos }) => {
    let currentNode = initialNode;
    const dom = document.createElement("div");
    dom.dataset.type = "table-float";
    const content = document.createElement("div");
    content.className = "table-float-content";
    const controls = document.createElement("div");
    controls.className = "table-float-controls";
    controls.setAttribute("contenteditable", "false");
    const labelControl = document.createElement("label");
    labelControl.className = "table-float-control";
    const labelCaption = document.createElement("span");
    labelCaption.textContent = wysiwygMessage("table.labelField");
    const label = document.createElement("input");
    label.type = "text";
    label.className = "table-float-label";
    label.placeholder = wysiwygMessage("table.labelPlaceholder");
    label.setAttribute("aria-label", wysiwygMessage("table.labelField"));
    labelControl.append(labelCaption, label);
    const addCaption = document.createElement("button");
    addCaption.type = "button";
    addCaption.className = "table-float-add-caption";
    addCaption.textContent = wysiwygMessage("table.addCaption");
    controls.append(labelControl, addCaption);
    dom.append(content, controls);

    const hasCaption = () => {
      let found = false;
      currentNode.forEach((child) => {
        if (child.type.name === "tableCaption") found = true;
      });
      return found;
    };
    const updatePresentation = () => {
      dom.dataset.captionPosition = currentNode.attrs.captionPosition === "above" ? "above" : "below";
      dom.dataset.floating = currentNode.attrs.floating === false ? "false" : "true";
      if (document.activeElement !== label) {
        label.value = typeof currentNode.attrs.label === "string" ? currentNode.attrs.label : "";
      }
      addCaption.hidden = hasCaption();
    };
    updatePresentation();

    const commitLabel = () => {
      const value = label.value.trim();
      updateNodeAttribute(view, getPos, currentNode.type, "label", value === "" ? null : value);
    };
    const onLabelKey = (event: KeyboardEvent) => {
      if (event.key === "Enter" || event.key === "Escape") {
        event.preventDefault();
        label.blur();
        view.dom.focus({ preventScroll: true });
      }
    };
    const onAddCaption = () => {
      const position = getPos();
      if (typeof position !== "number") return;
      const liveNode = view.state.doc.nodeAt(position);
      if (!liveNode || liveNode.type !== currentNode.type || hasCaption()) return;
      const caption = view.state.schema.nodes.tableCaption.create();
      const insertAt = position + liveNode.nodeSize - 1;
      const transaction = view.state.tr.insert(insertAt, caption);
      view.dispatch(transaction.setSelection(TextSelection.create(transaction.doc, insertAt + 1)));
      view.focus();
    };
    label.addEventListener("change", commitLabel);
    label.addEventListener("keydown", onLabelKey);
    addCaption.addEventListener("click", onAddCaption);

    return {
      dom,
      contentDOM: content,
      update(nextNode) {
        if (nextNode.type !== currentNode.type) return false;
        currentNode = nextNode;
        updatePresentation();
        return true;
      },
      stopEvent(event) {
        return event.target instanceof Element && controls.contains(event.target);
      },
      ignoreMutation(mutation) {
        return mutation.type !== "selection" && controls.contains(mutation.target);
      },
      destroy() {
        label.removeEventListener("change", commitLabel);
        label.removeEventListener("keydown", onLabelKey);
        addCaption.removeEventListener("click", onAddCaption);
      },
    };
  };
}

export const TableFloat = Node.create({
  name: "tableFloat",
  group: "block",
  content: "table tableCaption?",
  isolating: true,
  defining: true,

  addAttributes() {
    return {
      placement: stringAttribute("placement", null),
      centering: booleanAttribute("centering", true),
      label: stringAttribute("label", null),
      captionPosition: stringAttribute("captionPosition", "above", "caption-position"),
      floating: booleanAttribute("floating", true),
      columns: {
        default: [] as TableColumn[],
        parseHTML: (element: HTMLElement) => tableSpecToColumns(element.getAttribute("data-columns") ?? "") ?? [],
        renderHTML: (attributes: Record<string, unknown>) => ({
          "data-columns": columnsToTableSpec(normalizeTableColumns(attributes.columns)),
        }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="table-float"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-type": "table-float" }), 0];
  },

  addNodeView() {
    return tableFloatNodeView();
  },
});
