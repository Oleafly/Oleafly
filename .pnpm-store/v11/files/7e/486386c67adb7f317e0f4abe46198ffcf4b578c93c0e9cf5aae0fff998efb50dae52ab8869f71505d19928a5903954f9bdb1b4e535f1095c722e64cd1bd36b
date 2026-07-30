var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// src/keymap/list-keymap.ts
import { Extension } from "@tiptap/core";

// src/keymap/listHelpers/index.ts
var listHelpers_exports = {};
__export(listHelpers_exports, {
  findListItemPos: () => findListItemPos,
  getNextListDepth: () => getNextListDepth,
  handleBackspace: () => handleBackspace,
  handleDelete: () => handleDelete,
  hasListBefore: () => hasListBefore,
  hasListItemAfter: () => hasListItemAfter,
  hasListItemBefore: () => hasListItemBefore,
  listItemHasSubList: () => listItemHasSubList,
  nextListIsDeeper: () => nextListIsDeeper,
  nextListIsHigher: () => nextListIsHigher
});

// src/keymap/listHelpers/findListItemPos.ts
import { getNodeType } from "@tiptap/core";
var findListItemPos = (typeOrName, state) => {
  const { $from } = state.selection;
  const nodeType = getNodeType(typeOrName, state.schema);
  let currentNode = null;
  let currentDepth = $from.depth;
  let currentPos = $from.pos;
  let targetDepth = null;
  while (currentDepth > 0 && targetDepth === null) {
    currentNode = $from.node(currentDepth);
    if (currentNode.type === nodeType) {
      targetDepth = currentDepth;
    } else {
      currentDepth -= 1;
      currentPos -= 1;
    }
  }
  if (targetDepth === null) {
    return null;
  }
  return { $pos: state.doc.resolve(currentPos), depth: targetDepth };
};

// src/keymap/listHelpers/getNextListDepth.ts
import { getNodeAtPosition } from "@tiptap/core";
var getNextListDepth = (typeOrName, state) => {
  const listItemPos = findListItemPos(typeOrName, state);
  if (!listItemPos) {
    return false;
  }
  const [, depth] = getNodeAtPosition(state, typeOrName, listItemPos.$pos.pos + 4);
  return depth;
};

// src/keymap/listHelpers/handleBackspace.ts
import { isAtStartOfNode, isNodeActive } from "@tiptap/core";

// src/keymap/listHelpers/hasListBefore.ts
var hasListBefore = (editorState, name, parentListTypes) => {
  const { $anchor } = editorState.selection;
  const previousNodePos = Math.max(0, $anchor.pos - 2);
  const previousNode = editorState.doc.resolve(previousNodePos).node();
  if (!previousNode || !parentListTypes.includes(previousNode.type.name)) {
    return false;
  }
  return true;
};

// src/keymap/listHelpers/handleBackspace.ts
var handleBackspace = (editor, name, parentListTypes) => {
  if (editor.commands.undoInputRule()) {
    return true;
  }
  if (editor.state.selection.from !== editor.state.selection.to) {
    return false;
  }
  if (!isNodeActive(editor.state, name) && hasListBefore(editor.state, name, parentListTypes)) {
    const { $anchor } = editor.state.selection;
    const $listPos = editor.state.doc.resolve($anchor.before() - 1);
    const listDescendants = [];
    $listPos.node().descendants((node, pos) => {
      if (node.type.name === name) {
        listDescendants.push({ node, pos });
      }
    });
    const lastItem = listDescendants.at(-1);
    if (!lastItem) {
      return false;
    }
    const $lastItemPos = editor.state.doc.resolve($listPos.start() + lastItem.pos + 1);
    return editor.chain().cut({ from: $anchor.start() - 1, to: $anchor.end() + 1 }, $lastItemPos.end()).joinForward().run();
  }
  if (!isNodeActive(editor.state, name)) {
    return false;
  }
  if (!isAtStartOfNode(editor.state)) {
    return false;
  }
  return editor.chain().liftListItem(name).run();
};

// src/keymap/listHelpers/handleDelete.ts
import { isAtEndOfNode, isNodeActive as isNodeActive2 } from "@tiptap/core";

// src/keymap/listHelpers/nextListIsDeeper.ts
var nextListIsDeeper = (typeOrName, state) => {
  const listDepth = getNextListDepth(typeOrName, state);
  const listItemPos = findListItemPos(typeOrName, state);
  if (!listItemPos || !listDepth) {
    return false;
  }
  if (listDepth > listItemPos.depth) {
    return true;
  }
  return false;
};

// src/keymap/listHelpers/nextListIsHigher.ts
var nextListIsHigher = (typeOrName, state) => {
  const listDepth = getNextListDepth(typeOrName, state);
  const listItemPos = findListItemPos(typeOrName, state);
  if (!listItemPos || !listDepth) {
    return false;
  }
  if (listDepth < listItemPos.depth) {
    return true;
  }
  return false;
};

// src/keymap/listHelpers/handleDelete.ts
var handleDelete = (editor, name) => {
  if (!isNodeActive2(editor.state, name)) {
    return false;
  }
  if (!isAtEndOfNode(editor.state, name)) {
    return false;
  }
  const { selection } = editor.state;
  const { $from, $to } = selection;
  if (!selection.empty && $from.sameParent($to)) {
    return false;
  }
  if (nextListIsDeeper(name, editor.state)) {
    return editor.chain().focus(editor.state.selection.from + 4).lift(name).joinBackward().run();
  }
  if (nextListIsHigher(name, editor.state)) {
    return editor.chain().joinForward().joinBackward().run();
  }
  return editor.commands.joinItemForward();
};

// src/keymap/listHelpers/hasListItemAfter.ts
var hasListItemAfter = (typeOrName, state) => {
  var _a;
  const { $anchor } = state.selection;
  const $targetPos = state.doc.resolve($anchor.pos - $anchor.parentOffset - 2);
  if ($targetPos.index() === $targetPos.parent.childCount - 1) {
    return false;
  }
  if (((_a = $targetPos.nodeAfter) == null ? void 0 : _a.type.name) !== typeOrName) {
    return false;
  }
  return true;
};

// src/keymap/listHelpers/hasListItemBefore.ts
var hasListItemBefore = (typeOrName, state) => {
  var _a;
  const { $anchor } = state.selection;
  const $targetPos = state.doc.resolve($anchor.pos - 2);
  if ($targetPos.index() === 0) {
    return false;
  }
  if (((_a = $targetPos.nodeBefore) == null ? void 0 : _a.type.name) !== typeOrName) {
    return false;
  }
  return true;
};

// src/keymap/listHelpers/listItemHasSubList.ts
import { getNodeType as getNodeType2 } from "@tiptap/core";
var listItemHasSubList = (typeOrName, state, node) => {
  if (!node) {
    return false;
  }
  const nodeType = getNodeType2(typeOrName, state.schema);
  let hasSubList = false;
  node.descendants((child) => {
    if (child.type === nodeType) {
      hasSubList = true;
    }
  });
  return hasSubList;
};

// src/keymap/list-keymap.ts
var ListKeymap = Extension.create({
  name: "listKeymap",
  addOptions() {
    return {
      listTypes: [
        {
          itemName: "listItem",
          wrapperNames: ["bulletList", "orderedList"]
        },
        {
          itemName: "taskItem",
          wrapperNames: ["taskList"]
        }
      ]
    };
  },
  addKeyboardShortcuts() {
    return {
      Delete: ({ editor }) => {
        let handled = false;
        this.options.listTypes.forEach(({ itemName }) => {
          if (editor.state.schema.nodes[itemName] === void 0) {
            return;
          }
          if (handleDelete(editor, itemName)) {
            handled = true;
          }
        });
        return handled;
      },
      "Mod-Delete": ({ editor }) => {
        let handled = false;
        this.options.listTypes.forEach(({ itemName }) => {
          if (editor.state.schema.nodes[itemName] === void 0) {
            return;
          }
          if (handleDelete(editor, itemName)) {
            handled = true;
          }
        });
        return handled;
      },
      Backspace: ({ editor }) => {
        let handled = false;
        this.options.listTypes.forEach(({ itemName, wrapperNames }) => {
          if (editor.state.schema.nodes[itemName] === void 0) {
            return;
          }
          if (handleBackspace(editor, itemName, wrapperNames)) {
            handled = true;
          }
        });
        return handled;
      },
      "Mod-Backspace": ({ editor }) => {
        let handled = false;
        this.options.listTypes.forEach(({ itemName, wrapperNames }) => {
          if (editor.state.schema.nodes[itemName] === void 0) {
            return;
          }
          if (handleBackspace(editor, itemName, wrapperNames)) {
            handled = true;
          }
        });
        return handled;
      }
    };
  }
});
export {
  ListKeymap,
  listHelpers_exports as listHelpers
};
//# sourceMappingURL=index.js.map