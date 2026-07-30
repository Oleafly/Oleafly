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
  Code: () => Code,
  default: () => index_default,
  inputRegex: () => inputRegex,
  inputRegexMatch: () => inputRegexMatch,
  pasteRegex: () => pasteRegex,
  pasteRegexMatch: () => pasteRegexMatch
});
module.exports = __toCommonJS(index_exports);

// src/code.ts
var import_core = require("@tiptap/core");
var inputRegex = /(^|[^`])`([^`]+)`(?!`)$/;
var pasteRegex = /(^|[^`])`([^`]+)`(?!`)/g;
var inputRegexMatch = (text) => {
  const match = /`([^`]+)`(?!`)$/.exec(text);
  if (!match) {
    return null;
  }
  if (match.index > 0 && text[match.index - 1] === "`") {
    return null;
  }
  return {
    index: match.index,
    text: match[0],
    replaceWith: match[1]
  };
};
var pasteRegexMatch = (text) => {
  const regex = /`([^`]+)`(?!`)/g;
  const matches = [];
  let match;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > 0 && text[match.index - 1] === "`") {
      continue;
    }
    matches.push({
      index: match.index,
      text: match[0],
      replaceWith: match[1]
    });
  }
  return matches;
};
var Code = import_core.Mark.create({
  name: "code",
  addOptions() {
    return {
      HTMLAttributes: {}
    };
  },
  excludes: "_",
  code: true,
  exitable: true,
  parseHTML() {
    return [{ tag: "code" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["code", (0, import_core.mergeAttributes)(this.options.HTMLAttributes, HTMLAttributes), 0];
  },
  markdownTokenName: "codespan",
  parseMarkdown: (token, helpers) => {
    return helpers.applyMark("code", [{ type: "text", text: token.text || "" }]);
  },
  renderMarkdown: (node, h) => {
    if (!node.content) {
      return "";
    }
    return `\`${h.renderChildren(node.content)}\``;
  },
  addCommands() {
    return {
      setCode: () => ({ commands }) => {
        return commands.setMark(this.name);
      },
      toggleCode: () => ({ commands }) => {
        return commands.toggleMark(this.name);
      },
      unsetCode: () => ({ commands }) => {
        return commands.unsetMark(this.name);
      }
    };
  },
  addKeyboardShortcuts() {
    return {
      "Mod-e": () => this.editor.commands.toggleCode()
    };
  },
  addInputRules() {
    return [
      (0, import_core.markInputRule)({
        find: inputRegexMatch,
        type: this.type
      })
    ];
  },
  addPasteRules() {
    return [
      (0, import_core.markPasteRule)({
        find: pasteRegexMatch,
        type: this.type
      })
    ];
  }
});

// src/index.ts
var index_default = Code;
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  Code,
  inputRegex,
  inputRegexMatch,
  pasteRegex,
  pasteRegexMatch
});
//# sourceMappingURL=index.cjs.map