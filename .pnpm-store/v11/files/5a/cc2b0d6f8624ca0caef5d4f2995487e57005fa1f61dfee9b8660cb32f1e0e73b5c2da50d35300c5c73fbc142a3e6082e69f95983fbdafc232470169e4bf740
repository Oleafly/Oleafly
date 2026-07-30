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

// src/index.ts
var index_exports = {};
__export(index_exports, {
  Blockquote: () => Blockquote,
  default: () => index_default,
  inputRegex: () => inputRegex
});
module.exports = __toCommonJS(index_exports);

// src/blockquote.tsx
var import_core = require("@tiptap/core");

// src/handleBackspace.ts
var import_state = require("@tiptap/pm/state");
var handleBackspace = (editor, type) => {
  var _a;
  const { state, view } = editor;
  const { selection } = state;
  if (!selection.empty) return false;
  const { $from } = selection;
  if ($from.parentOffset !== 0) return false;
  const parentDepth = $from.depth - 1;
  if (parentDepth < 0) return false;
  const parent = $from.node(parentDepth);
  const index = $from.index(parentDepth);
  if (index === 0) return false;
  if (parent.type === type) {
    return editor.commands.lift(type.name);
  }
  const previous = parent.child(index - 1);
  if (previous.type !== type || !((_a = previous.lastChild) == null ? void 0 : _a.isTextblock)) {
    return false;
  }
  const blockStart = $from.before();
  const insideBlockquoteEnd = blockStart - 1;
  const targetPos = insideBlockquoteEnd - 1;
  const { tr } = state;
  tr.delete(blockStart, $from.after()).insert(targetPos, $from.parent.content);
  tr.setSelection(import_state.TextSelection.create(tr.doc, targetPos));
  view.dispatch(tr.scrollIntoView());
  return true;
};

// src/blockquote.tsx
var import_jsx_runtime = require("@tiptap/core/jsx-runtime");
var inputRegex = /^\s*>\s$/;
var Blockquote = import_core.Node.create({
  name: "blockquote",
  addOptions() {
    return {
      HTMLAttributes: {}
    };
  },
  content: "block+",
  group: "block",
  defining: true,
  parseHTML() {
    return [{ tag: "blockquote" }];
  },
  renderHTML({ HTMLAttributes }) {
    return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("blockquote", { ...(0, import_core.mergeAttributes)(this.options.HTMLAttributes, HTMLAttributes), children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("slot", {}) });
  },
  parseMarkdown: (token, helpers) => {
    var _a;
    const parseBlockChildren = (_a = helpers.parseBlockChildren) != null ? _a : helpers.parseChildren;
    return helpers.createNode("blockquote", void 0, parseBlockChildren(token.tokens || []));
  },
  renderMarkdown: (node, h) => {
    if (!node.content) {
      return "";
    }
    const prefix = ">";
    const result = [];
    node.content.forEach((child, index) => {
      var _a, _b;
      const childContent = (_b = (_a = h.renderChild) == null ? void 0 : _a.call(h, child, index)) != null ? _b : h.renderChildren([child]);
      const lines = childContent.split("\n");
      const linesWithPrefix = lines.map((line) => {
        if (line.trim() === "") {
          return prefix;
        }
        return `${prefix} ${line}`;
      });
      result.push(linesWithPrefix.join("\n"));
    });
    return result.join(`
${prefix}
`);
  },
  addCommands() {
    return {
      setBlockquote: () => ({ commands }) => {
        return commands.wrapIn(this.name);
      },
      toggleBlockquote: () => ({ commands }) => {
        return commands.toggleWrap(this.name);
      },
      unsetBlockquote: () => ({ commands }) => {
        return commands.lift(this.name);
      }
    };
  },
  addKeyboardShortcuts() {
    return {
      "Mod-Shift-b": () => this.editor.commands.toggleBlockquote(),
      Backspace: () => handleBackspace(this.editor, this.type)
    };
  },
  addInputRules() {
    return [
      (0, import_core.wrappingInputRule)({
        find: inputRegex,
        type: this.type
      })
    ];
  }
});

// src/index.ts
var index_default = Blockquote;
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  Blockquote,
  inputRegex
});
//# sourceMappingURL=index.cjs.map