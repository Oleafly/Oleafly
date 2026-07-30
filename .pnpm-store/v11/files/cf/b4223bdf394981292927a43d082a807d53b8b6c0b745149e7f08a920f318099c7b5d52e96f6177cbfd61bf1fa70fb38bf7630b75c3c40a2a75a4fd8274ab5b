// src/task-item/task-item.ts
import {
  getRenderedAttributes,
  mergeAttributes,
  Node,
  renderNestedMarkdownContent,
  wrappingInputRule
} from "@tiptap/core";

// src/helpers/createBranchingListDeleteKeymap.ts
import { Extension } from "@tiptap/core";

// src/helpers/hoistBranchingNestedList.ts
import { Fragment } from "@tiptap/pm/model";

// src/helpers/getBranchingNestedListAtCursor.ts
var getBranchingNestedListAtCursor = (state, itemName, wrapperNames) => {
  const { selection } = state;
  if (!selection.empty) {
    return null;
  }
  const { $from } = selection;
  if (!$from.parent.isTextblock) {
    return null;
  }
  if ($from.parentOffset !== $from.parent.content.size) {
    return null;
  }
  let listItemDepth = -1;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    if ($from.node(depth).type.name === itemName) {
      listItemDepth = depth;
      break;
    }
  }
  if (listItemDepth < 0) {
    return null;
  }
  const listItem = $from.node(listItemDepth);
  const indexInListItem = $from.index(listItemDepth);
  if (indexInListItem + 1 >= listItem.childCount) {
    return null;
  }
  const nextChild = listItem.child(indexInListItem + 1);
  if (!wrapperNames.includes(nextChild.type.name)) {
    return null;
  }
  const itemType = state.schema.nodes[itemName];
  let hasBranching = false;
  nextChild.forEach((child) => {
    if (child.type === itemType && child.childCount > 1) {
      hasBranching = true;
    }
  });
  if (!hasBranching) {
    return null;
  }
  const nodeAfter = state.doc.resolve($from.after()).nodeAfter;
  if (!nodeAfter || !wrapperNames.includes(nodeAfter.type.name)) {
    return null;
  }
  const items = [];
  nodeAfter.forEach((child) => {
    items.push(child);
  });
  if (items.length === 0) {
    return null;
  }
  return {
    listItemDepth,
    nestedList: nodeAfter,
    nestedListPos: $from.after(),
    insertPos: $from.after(listItemDepth),
    items
  };
};

// src/helpers/hoistBranchingNestedList.ts
var hoistBranchingNestedList = (state, dispatch, itemName, wrapperNames) => {
  const context = getBranchingNestedListAtCursor(state, itemName, wrapperNames);
  if (!context) {
    return false;
  }
  const { selection } = state;
  const { nestedList, nestedListPos, insertPos, items } = context;
  const tr = state.tr;
  tr.delete(nestedListPos, nestedListPos + nestedList.nodeSize);
  const mappedInsertPos = tr.mapping.map(insertPos);
  tr.insert(mappedInsertPos, Fragment.from(items));
  tr.setSelection(selection.map(tr.doc, tr.mapping));
  if (dispatch) {
    dispatch(tr);
  }
  return true;
};

// src/helpers/handleDeleteBranchingNestedList.ts
var handleDeleteBranchingNestedList = (editor, itemName, wrapperNames) => {
  return hoistBranchingNestedList(editor.state, editor.view.dispatch, itemName, wrapperNames);
};

// src/helpers/createBranchingListDeleteKeymap.ts
var createBranchingListDeleteKeymap = (itemName, wrapperNames) => {
  return Extension.create({
    name: `${itemName}BranchingDeleteKeymap`,
    priority: 101,
    addKeyboardShortcuts() {
      const handleDelete = () => handleDeleteBranchingNestedList(this.editor, itemName, wrapperNames);
      return {
        Delete: handleDelete,
        "Mod-Delete": handleDelete
      };
    }
  });
};

// src/task-item/task-item.ts
var inputRegex = /^\s*(\[([( |x])?\])\s$/;
var TaskItem = Node.create({
  name: "taskItem",
  addOptions() {
    return {
      nested: false,
      HTMLAttributes: {},
      taskListTypeName: "taskList",
      a11y: void 0
    };
  },
  content() {
    return this.options.nested ? "paragraph block*" : "paragraph+";
  },
  defining: true,
  addAttributes() {
    return {
      checked: {
        default: false,
        keepOnSplit: false,
        parseHTML: (element) => {
          const dataChecked = element.getAttribute("data-checked");
          return dataChecked === "" || dataChecked === "true";
        },
        renderHTML: (attributes) => ({
          "data-checked": attributes.checked
        })
      }
    };
  },
  parseHTML() {
    return [
      {
        tag: `li[data-type="${this.name}"]`,
        priority: 51
      }
    ];
  },
  renderHTML({ node, HTMLAttributes }) {
    return [
      "li",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        "data-type": this.name
      }),
      [
        "label",
        [
          "input",
          {
            type: "checkbox",
            checked: node.attrs.checked ? "checked" : null
          }
        ],
        ["span"]
      ],
      ["div", 0]
    ];
  },
  parseMarkdown: (token, h) => {
    const content = [];
    if (token.tokens && token.tokens.length > 0) {
      content.push(h.createNode("paragraph", {}, h.parseInline(token.tokens)));
    } else if (token.text) {
      content.push(h.createNode("paragraph", {}, [h.createNode("text", { text: token.text })]));
    } else {
      content.push(h.createNode("paragraph", {}, []));
    }
    if (token.nestedTokens && token.nestedTokens.length > 0) {
      const nestedContent = h.parseChildren(token.nestedTokens);
      content.push(...nestedContent);
    }
    return h.createNode("taskItem", { checked: token.checked || false }, content);
  },
  renderMarkdown: (node, h) => {
    var _a;
    const checkedChar = ((_a = node.attrs) == null ? void 0 : _a.checked) ? "x" : " ";
    const prefix = `- [${checkedChar}] `;
    return renderNestedMarkdownContent(node, h, prefix);
  },
  addExtensions() {
    if (!this.options.nested) {
      return [];
    }
    return [createBranchingListDeleteKeymap(this.name, [this.options.taskListTypeName])];
  },
  addKeyboardShortcuts() {
    const shortcuts = {
      Enter: () => this.editor.commands.splitListItem(this.name),
      "Shift-Tab": () => this.editor.commands.liftListItem(this.name)
    };
    if (!this.options.nested) {
      return shortcuts;
    }
    return {
      ...shortcuts,
      Tab: () => this.editor.commands.sinkListItem(this.name)
    };
  },
  addNodeView() {
    return ({ node, HTMLAttributes, getPos, editor }) => {
      const listItem = document.createElement("li");
      const checkboxWrapper = document.createElement("label");
      const checkboxStyler = document.createElement("span");
      const checkbox = document.createElement("input");
      const content = document.createElement("div");
      const updateA11Y = (currentNode) => {
        var _a, _b;
        checkbox.ariaLabel = ((_b = (_a = this.options.a11y) == null ? void 0 : _a.checkboxLabel) == null ? void 0 : _b.call(_a, currentNode, checkbox.checked)) || `Task item checkbox for ${currentNode.textContent || "empty task item"}`;
      };
      updateA11Y(node);
      checkboxWrapper.contentEditable = "false";
      checkbox.type = "checkbox";
      checkbox.addEventListener("mousedown", (event) => event.preventDefault());
      checkbox.addEventListener("change", (event) => {
        if (!editor.isEditable && !this.options.onReadOnlyChecked) {
          checkbox.checked = !checkbox.checked;
          return;
        }
        const { checked } = event.target;
        if (editor.isEditable && typeof getPos === "function") {
          editor.chain().focus(void 0, { scrollIntoView: false }).command(({ tr }) => {
            const position = getPos();
            if (typeof position !== "number") {
              return false;
            }
            const currentNode = tr.doc.nodeAt(position);
            tr.setNodeMarkup(position, void 0, {
              ...currentNode == null ? void 0 : currentNode.attrs,
              checked
            });
            return true;
          }).run();
        }
        if (!editor.isEditable && this.options.onReadOnlyChecked) {
          if (!this.options.onReadOnlyChecked(node, checked)) {
            checkbox.checked = !checkbox.checked;
          }
        }
      });
      Object.entries(this.options.HTMLAttributes).forEach(([key, value]) => {
        listItem.setAttribute(key, value);
      });
      listItem.dataset.checked = node.attrs.checked;
      checkbox.checked = node.attrs.checked;
      checkboxWrapper.append(checkbox, checkboxStyler);
      listItem.append(checkboxWrapper, content);
      Object.entries(HTMLAttributes).forEach(([key, value]) => {
        listItem.setAttribute(key, value);
      });
      let prevRenderedAttributeKeys = new Set(Object.keys(HTMLAttributes));
      return {
        dom: listItem,
        contentDOM: content,
        update: (updatedNode) => {
          if (updatedNode.type !== this.type) {
            return false;
          }
          listItem.dataset.checked = updatedNode.attrs.checked;
          checkbox.checked = updatedNode.attrs.checked;
          updateA11Y(updatedNode);
          const extensionAttributes = editor.extensionManager.attributes;
          const newHTMLAttributes = getRenderedAttributes(updatedNode, extensionAttributes);
          const newKeys = new Set(Object.keys(newHTMLAttributes));
          const staticAttrs = this.options.HTMLAttributes;
          prevRenderedAttributeKeys.forEach((key) => {
            if (!newKeys.has(key)) {
              if (key in staticAttrs) {
                listItem.setAttribute(key, staticAttrs[key]);
              } else {
                listItem.removeAttribute(key);
              }
            }
          });
          Object.entries(newHTMLAttributes).forEach(([key, value]) => {
            if (value === null || value === void 0) {
              if (key in staticAttrs) {
                listItem.setAttribute(key, staticAttrs[key]);
              } else {
                listItem.removeAttribute(key);
              }
            } else {
              listItem.setAttribute(key, value);
            }
          });
          prevRenderedAttributeKeys = newKeys;
          return true;
        }
      };
    };
  },
  addInputRules() {
    return [
      wrappingInputRule({
        find: inputRegex,
        type: this.type,
        getAttributes: (match) => ({
          checked: match[match.length - 1] === "x"
        })
      })
    ];
  }
});
export {
  TaskItem,
  inputRegex
};
//# sourceMappingURL=index.js.map