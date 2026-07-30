"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/item/index.ts
var index_exports = {};
__export(index_exports, {
  ListItem: () => ListItem
});
module.exports = __toCommonJS(index_exports);

// src/item/list-item.ts
var import_core2 = require("@tiptap/core");

// src/helpers/createBranchingListDeleteKeymap.ts
var import_core = require("@tiptap/core");

// src/helpers/hoistBranchingNestedList.ts
var import_model = require("@tiptap/pm/model");

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
  tr.insert(mappedInsertPos, import_model.Fragment.from(items));
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
  return import_core.Extension.create({
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
var ListItem = import_core2.Node.create({
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
    return ["li", (0, import_core2.mergeAttributes)(this.options.HTMLAttributes, HTMLAttributes), 0];
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
    return (0, import_core2.renderNestedMarkdownContent)(
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
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  ListItem
});
//# sourceMappingURL=index.cjs.map