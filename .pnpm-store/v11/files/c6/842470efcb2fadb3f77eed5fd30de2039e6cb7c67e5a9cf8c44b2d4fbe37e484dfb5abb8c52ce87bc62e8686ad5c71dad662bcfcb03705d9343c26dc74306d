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
  Bold: () => Bold,
  default: () => index_default,
  starInputRegex: () => starInputRegex,
  starPasteRegex: () => starPasteRegex,
  underscoreInputRegex: () => underscoreInputRegex,
  underscorePasteRegex: () => underscorePasteRegex
});
module.exports = __toCommonJS(index_exports);

// src/bold.tsx
var import_core = require("@tiptap/core");
var import_jsx_runtime = require("@tiptap/core/jsx-runtime");
var starInputRegex = /(?:^|\s)(\*\*(?!\s+\*\*)((?:[^*]+))\*\*(?!\s+\*\*))$/;
var starPasteRegex = /(?:^|\s)(\*\*(?!\s+\*\*)((?:[^*]+))\*\*(?!\s+\*\*))/g;
var underscoreInputRegex = /(?:^|\s)(__(?!\s+__)((?:[^_]+))__(?!\s+__))$/;
var underscorePasteRegex = /(?:^|\s)(__(?!\s+__)((?:[^_]+))__(?!\s+__))/g;
var Bold = import_core.Mark.create({
  name: "bold",
  addOptions() {
    return {
      HTMLAttributes: {}
    };
  },
  parseHTML() {
    return [
      {
        tag: "strong"
      },
      {
        tag: "b",
        getAttrs: (node) => node.style.fontWeight !== "normal" && null
      },
      {
        style: "font-weight=400",
        clearMark: (mark) => mark.type.name === this.name
      },
      {
        style: "font-weight",
        getAttrs: (value) => /^(bold(er)?|[5-9]\d{2,})$/.test(value) && null
      }
    ];
  },
  renderHTML({ HTMLAttributes }) {
    return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { ...(0, import_core.mergeAttributes)(this.options.HTMLAttributes, HTMLAttributes), children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("slot", {}) });
  },
  markdownTokenName: "strong",
  parseMarkdown: (token, helpers) => {
    return helpers.applyMark("bold", helpers.parseInline(token.tokens || []));
  },
  markdownOptions: {
    htmlReopen: {
      open: "<strong>",
      close: "</strong>"
    }
  },
  renderMarkdown: (node, h) => {
    return `**${h.renderChildren(node)}**`;
  },
  addCommands() {
    return {
      setBold: () => ({ commands }) => {
        return commands.setMark(this.name);
      },
      toggleBold: () => ({ commands }) => {
        return commands.toggleMark(this.name);
      },
      unsetBold: () => ({ commands }) => {
        return commands.unsetMark(this.name);
      }
    };
  },
  addKeyboardShortcuts() {
    return {
      "Mod-b": () => this.editor.commands.toggleBold(),
      "Mod-B": () => this.editor.commands.toggleBold()
    };
  },
  addInputRules() {
    return [
      (0, import_core.markInputRule)({
        find: starInputRegex,
        type: this.type
      }),
      (0, import_core.markInputRule)({
        find: underscoreInputRegex,
        type: this.type
      })
    ];
  },
  addPasteRules() {
    return [
      (0, import_core.markPasteRule)({
        find: starPasteRegex,
        type: this.type
      }),
      (0, import_core.markPasteRule)({
        find: underscorePasteRegex,
        type: this.type
      })
    ];
  }
});

// src/index.ts
var index_default = Bold;
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  Bold,
  starInputRegex,
  starPasteRegex,
  underscoreInputRegex,
  underscorePasteRegex
});
//# sourceMappingURL=index.cjs.map