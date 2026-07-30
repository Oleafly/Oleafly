var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// src/kit/index.ts
import { Extension as Extension3 } from "@tiptap/core";

// src/bullet-list/bullet-list.ts
import { mergeAttributes, Node, wrappingInputRule } from "@tiptap/core";
var ListItemName = "listItem";
var TextStyleName = "textStyle";
var bulletListInputRegex = /^\s*([-+*])\s$/;
var BulletList = Node.create({
  name: "bulletList",
  addOptions() {
    return {
      itemTypeName: "listItem",
      HTMLAttributes: {},
      keepMarks: false,
      keepAttributes: false
    };
  },
  group: "block list",
  content() {
    return `${this.options.itemTypeName}+`;
  },
  parseHTML() {
    return [{ tag: "ul" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["ul", mergeAttributes(this.options.HTMLAttributes, HTMLAttributes), 0];
  },
  markdownTokenName: "list",
  parseMarkdown: (token, helpers) => {
    if (token.type !== "list" || token.ordered) {
      return [];
    }
    return {
      type: "bulletList",
      content: token.items ? helpers.parseChildren(token.items) : []
    };
  },
  renderMarkdown: (node, h) => {
    if (!node.content) {
      return "";
    }
    return h.renderChildren(node.content, "\n");
  },
  markdownOptions: {
    indentsContent: true
  },
  addCommands() {
    return {
      toggleBulletList: () => ({ commands, chain }) => {
        if (this.options.keepAttributes) {
          return chain().toggleList(this.name, this.options.itemTypeName, this.options.keepMarks).updateAttributes(ListItemName, this.editor.getAttributes(TextStyleName)).run();
        }
        return commands.toggleList(this.name, this.options.itemTypeName, this.options.keepMarks);
      }
    };
  },
  addKeyboardShortcuts() {
    return {
      "Mod-Shift-8": () => this.editor.commands.toggleBulletList()
    };
  },
  addInputRules() {
    let inputRule = wrappingInputRule({
      find: bulletListInputRegex,
      type: this.type
    });
    if (this.options.keepMarks || this.options.keepAttributes) {
      inputRule = wrappingInputRule({
        find: bulletListInputRegex,
        type: this.type,
        keepMarks: this.options.keepMarks,
        keepAttributes: this.options.keepAttributes,
        getAttributes: () => {
          return this.editor.getAttributes(TextStyleName);
        },
        editor: this.editor
      });
    }
    return [inputRule];
  }
});

// src/item/list-item.ts
import { mergeAttributes as mergeAttributes2, Node as Node2, renderNestedMarkdownContent } from "@tiptap/core";

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
      const handleDelete2 = () => handleDeleteBranchingNestedList(this.editor, itemName, wrapperNames);
      return {
        Delete: handleDelete2,
        "Mod-Delete": handleDelete2
      };
    }
  });
};

// src/ordered-list/roman.ts
var ROMAN_NUMERALS = [
  [1e3, "m"],
  [900, "cm"],
  [500, "d"],
  [400, "cd"],
  [100, "c"],
  [90, "xc"],
  [50, "l"],
  [40, "xl"],
  [10, "x"],
  [9, "ix"],
  [5, "v"],
  [4, "iv"],
  [1, "i"]
];
var ALPHA_NUMERALS = "abcdefghijklmnopqrstuvwxyz";
var ORDERED_LIST_ALPHA_MARKER_PATTERN = "[a-zA-Z]{1,2}";
var ORDERED_LIST_MARKER_PATTERN = String.raw`\d+|[ivxlcdmIVXLCDM]+|${ORDERED_LIST_ALPHA_MARKER_PATTERN}`;
function toRoman(num) {
  let remaining = num;
  let result = "";
  for (const [value, numeral] of ROMAN_NUMERALS) {
    while (remaining >= value) {
      result += numeral;
      remaining -= value;
    }
  }
  return result;
}
function toRomanUpper(num) {
  return toRoman(num).toUpperCase();
}
function fromRoman(roman) {
  const lower = roman.toLowerCase();
  let index = 0;
  let result = 0;
  while (index < lower.length) {
    let matched = false;
    for (const [value, numeral] of ROMAN_NUMERALS) {
      if (lower.startsWith(numeral, index)) {
        result += value;
        index += numeral.length;
        matched = true;
        break;
      }
    }
    if (!matched) {
      return 0;
    }
  }
  return result;
}
function isValidRoman(marker) {
  if (!/^[ivxlcdmIVXLCDM]+$/.test(marker)) {
    return false;
  }
  const value = fromRoman(marker);
  if (value <= 0) {
    return false;
  }
  const expected = marker === marker.toLowerCase() ? toRoman(value) : toRomanUpper(value);
  return expected === marker;
}
function fromAlpha(marker) {
  const lower = marker.toLowerCase();
  if (lower.length === 1) {
    return lower.charCodeAt(0) - "a".charCodeAt(0) + 1;
  }
  if (lower.length === 2) {
    const first = lower.charCodeAt(0) - "a".charCodeAt(0);
    const second = lower.charCodeAt(1) - "a".charCodeAt(0);
    return (first + 1) * 26 + second + 1;
  }
  return 0;
}
function toRomanAlpha(num) {
  if (num <= 26) {
    return ALPHA_NUMERALS[num - 1];
  }
  const first = Math.floor((num - 1) / 26) - 1;
  const second = (num - 1) % 26;
  if (first < 0) {
    return ALPHA_NUMERALS[second];
  }
  return ALPHA_NUMERALS[first] + ALPHA_NUMERALS[second];
}
function detectMarkerType(marker) {
  if (!marker || /^\d+$/.test(marker)) {
    return void 0;
  }
  if (isValidRoman(marker)) {
    return marker === marker.toLowerCase() ? "i" : "I";
  }
  if (/^[a-z]{1,2}$/.test(marker)) {
    return "a";
  }
  if (/^[A-Z]{1,2}$/.test(marker)) {
    return "A";
  }
  return void 0;
}
function markerToStart(marker) {
  if (/^\d+$/.test(marker)) {
    return parseInt(marker, 10);
  }
  const type = detectMarkerType(marker);
  if (type === "i" || type === "I") {
    return fromRoman(marker);
  }
  if (type === "a" || type === "A") {
    const start = fromAlpha(marker);
    return start > 0 ? start : 1;
  }
  const parsed = parseInt(marker, 10);
  return Number.isNaN(parsed) ? 1 : parsed;
}
function startToMarker(type, start) {
  if (type === "numeric") {
    return String(start);
  }
  switch (type) {
    case "a":
      return toRomanAlpha(start);
    case "A":
      return toRomanAlpha(start).toUpperCase();
    case "i":
      return toRoman(start);
    case "I":
      return toRomanUpper(start);
    default:
      return String(start);
  }
}
function areOrderedListMarkersSequential(markers) {
  var _a;
  if (markers.length === 0) {
    return false;
  }
  const firstType = (_a = detectMarkerType(markers[0])) != null ? _a : "numeric";
  const firstStart = markerToStart(markers[0]);
  if (firstStart < 1) {
    return false;
  }
  for (let i = 0; i < markers.length; i++) {
    const expected = startToMarker(firstType, firstStart + i);
    if (markers[i] !== expected) {
      return false;
    }
  }
  return true;
}
function parseListMarker(marker) {
  return {
    type: detectMarkerType(marker),
    start: markerToStart(marker)
  };
}
function buildOrderedListAttrsFromMarker(marker) {
  const { type, start } = parseListMarker(marker);
  const attrs = {};
  if (type) {
    attrs.type = type;
  }
  if (start !== 1) {
    attrs.start = start;
  }
  return attrs;
}
function getListMarker(type, index, separator = ". ") {
  const position = index + 1;
  if (!type || type === "1") {
    return `${position}${separator}`;
  }
  switch (type) {
    case "a":
      return `${toRomanAlpha(position)}${separator}`;
    case "A":
      return `${toRomanAlpha(position).toUpperCase()}${separator}`;
    case "i":
      return `${toRoman(position)}${separator}`;
    case "I":
      return `${toRomanUpper(position)}${separator}`;
    default:
      return `${position}${separator}`;
  }
}

// src/item/list-item.ts
function isSameLineOrderedListToken(token) {
  var _a, _b;
  const nestedToken = (_a = token.tokens) == null ? void 0 : _a[0];
  return Boolean(
    token.text && ((_b = token.tokens) == null ? void 0 : _b.length) === 1 && (nestedToken == null ? void 0 : nestedToken.type) === "list" && nestedToken.ordered && nestedToken.raw === token.text
  );
}
function parseSameLineOrderedListText(text, helpers) {
  if (helpers.tokenizeInline) {
    return helpers.parseInline(helpers.tokenizeInline(text));
  }
  return helpers.parseInline([
    {
      type: "text",
      raw: text,
      text
    }
  ]);
}
var ListItem = Node2.create({
  name: "listItem",
  addOptions() {
    return {
      HTMLAttributes: {},
      bulletListTypeName: "bulletList",
      orderedListTypeName: "orderedList"
    };
  },
  content: "paragraph block*",
  defining: true,
  parseHTML() {
    return [
      {
        tag: "li"
      }
    ];
  },
  renderHTML({ HTMLAttributes }) {
    return ["li", mergeAttributes2(this.options.HTMLAttributes, HTMLAttributes), 0];
  },
  markdownTokenName: "list_item",
  parseMarkdown: (token, helpers) => {
    var _a;
    if (token.type !== "list_item") {
      return [];
    }
    const parseBlockChildren = (_a = helpers.parseBlockChildren) != null ? _a : helpers.parseChildren;
    let content = [];
    if (token.tokens && token.tokens.length > 0) {
      if (isSameLineOrderedListToken(token)) {
        return {
          type: "listItem",
          content: [
            {
              type: "paragraph",
              content: parseSameLineOrderedListText(token.text || "", helpers)
            }
          ]
        };
      }
      const hasParagraphTokens = token.tokens.some((t) => t.type === "paragraph");
      if (hasParagraphTokens) {
        content = parseBlockChildren(token.tokens);
      } else {
        const firstToken = token.tokens[0];
        if (firstToken && firstToken.type === "text" && firstToken.tokens && firstToken.tokens.length > 0) {
          const inlineContent = helpers.parseInline(firstToken.tokens);
          content = [
            {
              type: "paragraph",
              content: inlineContent
            }
          ];
          if (token.tokens.length > 1) {
            const remainingTokens = token.tokens.slice(1);
            const additionalContent = parseBlockChildren(remainingTokens);
            content.push(...additionalContent);
          }
        } else {
          content = parseBlockChildren(token.tokens);
        }
      }
    }
    if (content.length === 0) {
      content = [
        {
          type: "paragraph",
          content: []
        }
      ];
    }
    return {
      type: "listItem",
      content
    };
  },
  renderMarkdown: (node, h, ctx) => {
    return renderNestedMarkdownContent(
      node,
      h,
      (context) => {
        var _a, _b, _c, _d;
        if (context.parentType === "bulletList") {
          return "- ";
        }
        if (context.parentType === "orderedList") {
          const start = ((_b = (_a = context.meta) == null ? void 0 : _a.parentAttrs) == null ? void 0 : _b.start) || 1;
          const type = (_d = (_c = context.meta) == null ? void 0 : _c.parentAttrs) == null ? void 0 : _d.type;
          const index = start - 1 + (context.index || 0);
          return getListMarker(type, index, ". ");
        }
        return "- ";
      },
      ctx
    );
  },
  addExtensions() {
    return [
      createBranchingListDeleteKeymap(this.name, [
        this.options.bulletListTypeName,
        this.options.orderedListTypeName
      ])
    ];
  },
  addKeyboardShortcuts() {
    return {
      Enter: () => this.editor.commands.splitListItem(this.name),
      Tab: () => this.editor.commands.sinkListItem(this.name),
      "Shift-Tab": () => this.editor.commands.liftListItem(this.name)
    };
  }
});

// src/keymap/list-keymap.ts
import { Extension as Extension2 } from "@tiptap/core";

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
var ListKeymap = Extension2.create({
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

// src/ordered-list/ordered-list.ts
import { Plugin } from "@tiptap/pm/state";
import { mergeAttributes as mergeAttributes3, Node as Node3, wrappingInputRule as wrappingInputRule2 } from "@tiptap/core";

// src/ordered-list/utils.ts
var ORDERED_LIST_ITEM_REGEX = new RegExp(
  `^(\\s*)(${ORDERED_LIST_MARKER_PATTERN})([.)])\\s+(.*)$`
);
var INDENTED_LINE_REGEX = /^\s/;
var PARAGRAPH_INTERRUPTERS = {
  heading: /^#{1,6}(?:\s|$)/,
  bulletItem: /^[-+*]\s+/,
  codeFence: /^(?:```|~~~)/,
  thematicBreak: /^(?:(?:-[ \t]*){3,}|(?:_[ \t]*){3,}|(?:\*[ \t]*){3,})$/
};
function isOrderedListMarkerLine(line) {
  return ORDERED_LIST_ITEM_REGEX.test(line.trimStart());
}
function isBlockContentLine(line) {
  const trimmedLine = line.trimStart();
  return PARAGRAPH_INTERRUPTERS.bulletItem.test(trimmedLine) || isOrderedListMarkerLine(trimmedLine) || PARAGRAPH_INTERRUPTERS.heading.test(trimmedLine) || // dash breaks are excluded: "---" directly below paragraph text is a
  // setext heading underline, not a thematic break
  PARAGRAPH_INTERRUPTERS.thematicBreak.test(trimmedLine) && !trimmedLine.startsWith("-") || // oxlint-disable-next-line prefer-string-starts-ends-with
  /^>\s?/.test(trimmedLine) || PARAGRAPH_INTERRUPTERS.codeFence.test(trimmedLine);
}
function interruptsLazyContinuation(line) {
  return Object.values(PARAGRAPH_INTERRUPTERS).some((pattern) => pattern.test(line));
}
function splitItemContent(contentLines) {
  const paragraphLines = [];
  const blockLines = [];
  let reachedBlockBoundary = false;
  contentLines.forEach((line) => {
    if (reachedBlockBoundary) {
      blockLines.push(line);
      return;
    }
    if (line.trim() === "") {
      reachedBlockBoundary = true;
      blockLines.push(line);
      return;
    }
    if (paragraphLines.length > 0 && isBlockContentLine(line)) {
      reachedBlockBoundary = true;
      blockLines.push(line);
      return;
    }
    paragraphLines.push(line);
  });
  return {
    paragraphLines,
    blockLines
  };
}
function collectOrderedListItems(lines) {
  const listItems = [];
  let currentLineIndex = 0;
  let consumed = 0;
  while (currentLineIndex < lines.length) {
    const line = lines[currentLineIndex];
    const match = line.match(ORDERED_LIST_ITEM_REGEX);
    if (!match) {
      break;
    }
    const [, indent, marker, _separator, content] = match;
    const indentLevel = indent.length;
    const number = parseInt(marker, 10);
    const markerType = isNaN(number) ? detectMarkerType(marker) : void 0;
    const itemNumber = isNaN(number) ? markerToStart(marker) : number;
    const itemContentLines = [content];
    let nextLineIndex = currentLineIndex + 1;
    const itemLines = [line];
    let sawBlankLine = false;
    while (nextLineIndex < lines.length) {
      const nextLine = lines[nextLineIndex];
      const nextMatch = nextLine.match(ORDERED_LIST_ITEM_REGEX);
      if (nextMatch) {
        break;
      }
      if (nextLine.trim() === "") {
        itemLines.push(nextLine);
        itemContentLines.push("");
        sawBlankLine = true;
        nextLineIndex += 1;
      } else if (nextLine.match(INDENTED_LINE_REGEX)) {
        const leadingWhitespace = nextLine.length - nextLine.trimStart().length;
        const contentIndent = indentLevel + marker.length + 1;
        itemLines.push(nextLine);
        itemContentLines.push(nextLine.slice(Math.min(leadingWhitespace, contentIndent)));
        nextLineIndex += 1;
      } else {
        if (sawBlankLine || interruptsLazyContinuation(nextLine)) {
          break;
        }
        itemLines.push(nextLine);
        itemContentLines.push(nextLine);
        nextLineIndex += 1;
      }
    }
    listItems.push({
      indent: indentLevel,
      number: itemNumber,
      type: markerType,
      content: itemContentLines.join("\n").trim(),
      contentLines: itemContentLines,
      raw: itemLines.join("\n")
    });
    consumed = nextLineIndex;
    currentLineIndex = nextLineIndex;
  }
  return [listItems, consumed];
}
var PLAIN_TEXT_ORDERED_LIST_LINE_REGEX = new RegExp(
  `^(${ORDERED_LIST_MARKER_PATTERN})([.)])\\s+(.+)$`
);
function parsePlainTextOrderedListPaste(text) {
  const lines = text.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length === 0) {
    return null;
  }
  const parsedItems = [];
  for (const line of lines) {
    const match = line.trim().match(PLAIN_TEXT_ORDERED_LIST_LINE_REGEX);
    if (!match) {
      return null;
    }
    parsedItems.push({
      marker: match[1],
      content: match[3]
    });
  }
  const markers = parsedItems.map((item) => item.marker);
  if (!areOrderedListMarkersSequential(markers)) {
    return null;
  }
  const attrs = buildOrderedListAttrsFromMarker(parsedItems[0].marker);
  return {
    type: "orderedList",
    attrs,
    content: parsedItems.map((item) => ({
      type: "listItem",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: item.content }]
        }
      ]
    }))
  };
}
function buildNestedStructure(items, baseIndent, lexer) {
  const result = [];
  let currentIndex = 0;
  while (currentIndex < items.length) {
    const item = items[currentIndex];
    if (item.indent === baseIndent) {
      const { paragraphLines, blockLines } = splitItemContent(item.contentLines);
      const mainText = paragraphLines.join("\n").trim();
      const tokens = [];
      if (mainText) {
        tokens.push({
          type: "paragraph",
          raw: mainText,
          tokens: lexer.inlineTokens(mainText)
        });
      }
      const additionalContent = blockLines.join("\n").trim();
      if (additionalContent) {
        const blockTokens = lexer.blockTokens(additionalContent);
        tokens.push(...blockTokens);
      }
      let lookAheadIndex = currentIndex + 1;
      const nestedItems = [];
      while (lookAheadIndex < items.length && items[lookAheadIndex].indent > baseIndent) {
        nestedItems.push(items[lookAheadIndex]);
        lookAheadIndex += 1;
      }
      if (nestedItems.length > 0) {
        const nextIndent = Math.min(...nestedItems.map((nestedItem) => nestedItem.indent));
        const nestedListItems = buildNestedStructure(nestedItems, nextIndent, lexer);
        tokens.push({
          type: "list",
          ordered: true,
          start: nestedItems[0].number,
          typeMarker: nestedItems[0].type,
          items: nestedListItems,
          raw: nestedItems.map((nestedItem) => nestedItem.raw).join("\n")
        });
      }
      result.push({
        type: "list_item",
        raw: item.raw,
        tokens
      });
      currentIndex = lookAheadIndex;
    } else {
      currentIndex += 1;
    }
  }
  return result;
}
function parseListItems(items, helpers) {
  return items.map((item) => {
    if (item.type !== "list_item") {
      return helpers.parseChildren([item])[0];
    }
    const content = [];
    if (item.tokens && item.tokens.length > 0) {
      item.tokens.forEach((itemToken) => {
        if (itemToken.type === "paragraph" || itemToken.type === "list" || itemToken.type === "blockquote" || itemToken.type === "code") {
          content.push(...helpers.parseChildren([itemToken]));
        } else if (itemToken.type === "text" && itemToken.tokens) {
          const inlineContent = helpers.parseChildren([itemToken]);
          content.push({
            type: "paragraph",
            content: inlineContent
          });
        } else {
          const parsed = helpers.parseChildren([itemToken]);
          if (parsed.length > 0) {
            content.push(...parsed);
          }
        }
      });
    }
    return {
      type: "listItem",
      content
    };
  });
}

// src/ordered-list/ordered-list.ts
var ListItemName2 = "listItem";
var TextStyleName2 = "textStyle";
var orderedListInputRegex = /^(\d+)\.\s$/;
function cssListStyleTypeToHtmlType(style) {
  const match = style.match(/list-style-type\s*:\s*([^;]+)/i);
  if (!match) {
    return null;
  }
  const cssValue = match[1].trim().toLowerCase();
  switch (cssValue) {
    case "upper-roman":
      return "I";
    case "lower-roman":
      return "i";
    case "upper-alpha":
    case "upper-latin":
      return "A";
    case "lower-alpha":
    case "lower-latin":
      return "a";
    default:
      return null;
  }
}
var OrderedList = Node3.create({
  name: "orderedList",
  addOptions() {
    return {
      itemTypeName: "listItem",
      HTMLAttributes: {},
      keepMarks: false,
      keepAttributes: false
    };
  },
  group: "block list",
  content() {
    return `${this.options.itemTypeName}+`;
  },
  addAttributes() {
    return {
      start: {
        default: 1,
        parseHTML: (element) => {
          return element.hasAttribute("start") ? parseInt(element.getAttribute("start") || "", 10) : 1;
        }
      },
      type: {
        default: null,
        parseHTML: (element) => {
          const htmlType = element.getAttribute("type");
          if (htmlType) {
            return htmlType;
          }
          const style = element.getAttribute("style");
          if (style) {
            const mappedFromOl = cssListStyleTypeToHtmlType(style);
            if (mappedFromOl) {
              return mappedFromOl;
            }
          }
          const firstLi = element.querySelector("li");
          if (firstLi) {
            const liStyle = firstLi.getAttribute("style");
            if (liStyle) {
              const mappedFromLi = cssListStyleTypeToHtmlType(liStyle);
              if (mappedFromLi) {
                return mappedFromLi;
              }
            }
          }
          return null;
        }
      }
    };
  },
  parseHTML() {
    return [
      {
        tag: "ol"
      }
    ];
  },
  renderHTML({ HTMLAttributes }) {
    const { start, type, ...attributesWithoutType } = HTMLAttributes;
    const attrs = mergeAttributes3(this.options.HTMLAttributes, attributesWithoutType);
    if (start !== 1) {
      attrs.start = start;
    }
    if (type && type !== "1") {
      attrs.type = type;
    }
    return ["ol", attrs, 0];
  },
  markdownTokenName: "list",
  parseMarkdown: (token, helpers) => {
    if (token.type !== "list" || !token.ordered) {
      return [];
    }
    const startValue = token.start || 1;
    const typeValue = token.typeMarker;
    const content = token.items ? parseListItems(token.items, helpers) : [];
    const attrs = {};
    if (startValue !== 1) {
      attrs.start = startValue;
    }
    if (typeValue) {
      attrs.type = typeValue;
    }
    if (Object.keys(attrs).length > 0) {
      return {
        type: "orderedList",
        attrs,
        content
      };
    }
    return {
      type: "orderedList",
      content
    };
  },
  renderMarkdown: (node, h) => {
    if (!node.content) {
      return "";
    }
    return h.renderChildren(node.content, "\n");
  },
  markdownTokenizer: {
    name: "orderedList",
    level: "block",
    // marked already breaks paragraphs before a start-of-line list marker. It
    // probes this with `src.slice(1)`, so any marker it surfaces here is
    // mid-line (like the "216)" in "(216) 555-1234") and must not start a list.
    // We still define the callback so marked does not fall back to probing
    // `tokenize`, which would re-introduce the mid-line split.
    start: () => -1,
    tokenize: (src, _tokens, lexer) => {
      var _a, _b;
      const lines = src.split("\n");
      const [listItems, consumed] = collectOrderedListItems(lines);
      if (listItems.length === 0) {
        return void 0;
      }
      const items = buildNestedStructure(listItems, listItems[0].indent, lexer);
      if (items.length === 0) {
        return void 0;
      }
      const startValue = ((_a = listItems[0]) == null ? void 0 : _a.number) || 1;
      const typeMarker = (_b = listItems[0]) == null ? void 0 : _b.type;
      return {
        type: "list",
        ordered: true,
        start: startValue,
        typeMarker,
        items,
        raw: lines.slice(0, consumed).join("\n")
      };
    }
  },
  markdownOptions: {
    indentsContent: true
  },
  addCommands() {
    return {
      toggleOrderedList: () => ({ commands, chain }) => {
        if (this.options.keepAttributes) {
          return chain().toggleList(this.name, this.options.itemTypeName, this.options.keepMarks).updateAttributes(ListItemName2, this.editor.getAttributes(TextStyleName2)).run();
        }
        return commands.toggleList(this.name, this.options.itemTypeName, this.options.keepMarks);
      }
    };
  },
  addKeyboardShortcuts() {
    return {
      "Mod-Shift-7": () => this.editor.commands.toggleOrderedList()
    };
  },
  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          handlePaste: (view, event) => {
            var _a, _b;
            const html = (_a = event.clipboardData) == null ? void 0 : _a.getData("text/html");
            if (html == null ? void 0 : html.trim()) {
              return false;
            }
            const text = (_b = event.clipboardData) == null ? void 0 : _b.getData("text/plain");
            if (!text) {
              return false;
            }
            const orderedListContent = parsePlainTextOrderedListPaste(text);
            if (!orderedListContent) {
              return false;
            }
            try {
              const orderedListNode = view.state.schema.nodeFromJSON(orderedListContent);
              const tr = view.state.tr.replaceSelectionWith(orderedListNode);
              view.dispatch(tr);
              return true;
            } catch {
              return false;
            }
          }
        }
      })
    ];
  },
  addInputRules() {
    const joinPredicate = (match, node) => {
      const hasDefaultType = !node.attrs.type || node.attrs.type === "1";
      return hasDefaultType && node.childCount + node.attrs.start === +match[1];
    };
    let inputRule = wrappingInputRule2({
      find: orderedListInputRegex,
      type: this.type,
      getAttributes: (match) => ({ start: +match[1] }),
      joinPredicate
    });
    if (this.options.keepMarks || this.options.keepAttributes) {
      inputRule = wrappingInputRule2({
        find: orderedListInputRegex,
        type: this.type,
        keepMarks: this.options.keepMarks,
        keepAttributes: this.options.keepAttributes,
        getAttributes: (match) => ({ start: +match[1], ...this.editor.getAttributes(TextStyleName2) }),
        joinPredicate,
        editor: this.editor
      });
    }
    return [inputRule];
  }
});

// src/task-item/task-item.ts
import {
  getRenderedAttributes,
  mergeAttributes as mergeAttributes4,
  Node as Node4,
  renderNestedMarkdownContent as renderNestedMarkdownContent2,
  wrappingInputRule as wrappingInputRule3
} from "@tiptap/core";
var inputRegex = /^\s*(\[([( |x])?\])\s$/;
var TaskItem = Node4.create({
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
      mergeAttributes4(this.options.HTMLAttributes, HTMLAttributes, {
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
    return renderNestedMarkdownContent2(node, h, prefix);
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
      wrappingInputRule3({
        find: inputRegex,
        type: this.type,
        getAttributes: (match) => ({
          checked: match[match.length - 1] === "x"
        })
      })
    ];
  }
});

// src/task-list/task-list.ts
import { mergeAttributes as mergeAttributes5, Node as Node5, parseIndentedBlocks } from "@tiptap/core";
var TaskList = Node5.create({
  name: "taskList",
  addOptions() {
    return {
      itemTypeName: "taskItem",
      HTMLAttributes: {}
    };
  },
  group: "block list",
  content() {
    return `${this.options.itemTypeName}+`;
  },
  parseHTML() {
    return [
      {
        tag: `ul[data-type="${this.name}"]`,
        priority: 51
      }
    ];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "ul",
      mergeAttributes5(this.options.HTMLAttributes, HTMLAttributes, { "data-type": this.name }),
      0
    ];
  },
  parseMarkdown: (token, h) => {
    return h.createNode("taskList", {}, h.parseChildren(token.items || []));
  },
  renderMarkdown: (node, h) => {
    if (!node.content) {
      return "";
    }
    return h.renderChildren(node.content, "\n");
  },
  markdownTokenizer: {
    name: "taskList",
    level: "block",
    start(src) {
      var _a;
      const index = (_a = src.match(/^\s*[-+*]\s+\[([ xX])\]\s+/)) == null ? void 0 : _a.index;
      return index !== void 0 ? index : -1;
    },
    tokenize(src, tokens, lexer) {
      const parseTaskListContent = (content) => {
        const nestedResult = parseIndentedBlocks(
          content,
          {
            itemPattern: /^(\s*)([-+*])\s+\[([ xX])\]\s+(.*)$/,
            extractItemData: (match) => ({
              indentLevel: match[1].length,
              mainContent: match[4],
              checked: match[3].toLowerCase() === "x"
            }),
            createToken: (data, nestedTokens) => ({
              type: "taskItem",
              raw: "",
              mainContent: data.mainContent,
              indentLevel: data.indentLevel,
              checked: data.checked,
              text: data.mainContent,
              tokens: lexer.inlineTokens(data.mainContent),
              nestedTokens
            }),
            // Allow recursive nesting
            customNestedParser: parseTaskListContent
          },
          lexer
        );
        if (nestedResult) {
          const taskListToken = {
            type: "taskList",
            raw: nestedResult.raw,
            items: nestedResult.items
          };
          const remainder = content.slice(nestedResult.raw.length);
          if (remainder.trim()) {
            return [taskListToken, ...lexer.blockTokens(remainder)];
          }
          return [taskListToken];
        }
        return lexer.blockTokens(content);
      };
      const result = parseIndentedBlocks(
        src,
        {
          itemPattern: /^(\s*)([-+*])\s+\[([ xX])\]\s+(.*)$/,
          extractItemData: (match) => ({
            indentLevel: match[1].length,
            mainContent: match[4],
            checked: match[3].toLowerCase() === "x"
          }),
          createToken: (data, nestedTokens) => ({
            type: "taskItem",
            raw: "",
            mainContent: data.mainContent,
            indentLevel: data.indentLevel,
            checked: data.checked,
            text: data.mainContent,
            tokens: lexer.inlineTokens(data.mainContent),
            nestedTokens
          }),
          // Use the recursive parser for nested content
          customNestedParser: parseTaskListContent
        },
        lexer
      );
      if (!result) {
        return void 0;
      }
      return {
        type: "taskList",
        raw: result.raw,
        items: result.items
      };
    }
  },
  markdownOptions: {
    indentsContent: true
  },
  addCommands() {
    return {
      toggleTaskList: () => ({ commands }) => {
        return commands.toggleList(this.name, this.options.itemTypeName);
      }
    };
  },
  addKeyboardShortcuts() {
    return {
      "Mod-Shift-9": () => this.editor.commands.toggleTaskList()
    };
  }
});

// src/kit/index.ts
var ListKit = Extension3.create({
  name: "listKit",
  addExtensions() {
    const extensions = [];
    if (this.options.bulletList !== false) {
      extensions.push(BulletList.configure(this.options.bulletList));
    }
    if (this.options.listItem !== false) {
      extensions.push(ListItem.configure(this.options.listItem));
    }
    if (this.options.listKeymap !== false) {
      extensions.push(ListKeymap.configure(this.options.listKeymap));
    }
    if (this.options.orderedList !== false) {
      extensions.push(OrderedList.configure(this.options.orderedList));
    }
    if (this.options.taskItem !== false) {
      extensions.push(TaskItem.configure(this.options.taskItem));
    }
    if (this.options.taskList !== false) {
      extensions.push(TaskList.configure(this.options.taskList));
    }
    return extensions;
  }
});
export {
  ListKit
};
//# sourceMappingURL=index.js.map