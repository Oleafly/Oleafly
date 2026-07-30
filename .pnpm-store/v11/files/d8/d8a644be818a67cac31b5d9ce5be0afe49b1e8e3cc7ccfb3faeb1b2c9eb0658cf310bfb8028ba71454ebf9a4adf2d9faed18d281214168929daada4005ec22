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
  StarterKit: () => StarterKit,
  default: () => index_default
});
module.exports = __toCommonJS(index_exports);

// src/starter-kit.ts
var import_core = require("@tiptap/core");
var import_extension_blockquote = require("@tiptap/extension-blockquote");
var import_extension_bold = require("@tiptap/extension-bold");
var import_extension_code = require("@tiptap/extension-code");
var import_extension_code_block = require("@tiptap/extension-code-block");
var import_extension_document = require("@tiptap/extension-document");
var import_extension_hard_break = require("@tiptap/extension-hard-break");
var import_extension_heading = require("@tiptap/extension-heading");
var import_extension_horizontal_rule = require("@tiptap/extension-horizontal-rule");
var import_extension_italic = require("@tiptap/extension-italic");
var import_extension_link = require("@tiptap/extension-link");
var import_extension_list = require("@tiptap/extension-list");
var import_extension_paragraph = require("@tiptap/extension-paragraph");
var import_extension_strike = require("@tiptap/extension-strike");
var import_extension_text = require("@tiptap/extension-text");
var import_extension_underline = require("@tiptap/extension-underline");
var import_extensions = require("@tiptap/extensions");
var StarterKit = import_core.Extension.create({
  name: "starterKit",
  addExtensions() {
    var _a, _b, _c, _d;
    const extensions = [];
    if (this.options.bold !== false) {
      extensions.push(import_extension_bold.Bold.configure(this.options.bold));
    }
    if (this.options.blockquote !== false) {
      extensions.push(import_extension_blockquote.Blockquote.configure(this.options.blockquote));
    }
    if (this.options.bulletList !== false) {
      extensions.push(import_extension_list.BulletList.configure(this.options.bulletList));
    }
    if (this.options.code !== false) {
      extensions.push(import_extension_code.Code.configure(this.options.code));
    }
    if (this.options.codeBlock !== false) {
      extensions.push(import_extension_code_block.CodeBlock.configure(this.options.codeBlock));
    }
    if (this.options.document !== false) {
      extensions.push(import_extension_document.Document.configure(this.options.document));
    }
    if (this.options.dropcursor !== false) {
      extensions.push(import_extensions.Dropcursor.configure(this.options.dropcursor));
    }
    if (this.options.gapcursor !== false) {
      extensions.push(import_extensions.Gapcursor.configure(this.options.gapcursor));
    }
    if (this.options.hardBreak !== false) {
      extensions.push(import_extension_hard_break.HardBreak.configure(this.options.hardBreak));
    }
    if (this.options.heading !== false) {
      extensions.push(import_extension_heading.Heading.configure(this.options.heading));
    }
    if (this.options.undoRedo !== false) {
      extensions.push(import_extensions.UndoRedo.configure(this.options.undoRedo));
    }
    if (this.options.horizontalRule !== false) {
      extensions.push(import_extension_horizontal_rule.HorizontalRule.configure(this.options.horizontalRule));
    }
    if (this.options.italic !== false) {
      extensions.push(import_extension_italic.Italic.configure(this.options.italic));
    }
    if (this.options.listItem !== false) {
      extensions.push(import_extension_list.ListItem.configure(this.options.listItem));
    }
    if (this.options.listKeymap !== false) {
      extensions.push(import_extension_list.ListKeymap.configure((_a = this.options) == null ? void 0 : _a.listKeymap));
    }
    if (this.options.link !== false) {
      extensions.push(import_extension_link.Link.configure((_b = this.options) == null ? void 0 : _b.link));
    }
    if (this.options.orderedList !== false) {
      extensions.push(import_extension_list.OrderedList.configure(this.options.orderedList));
    }
    if (this.options.paragraph !== false) {
      extensions.push(import_extension_paragraph.Paragraph.configure(this.options.paragraph));
    }
    if (this.options.strike !== false) {
      extensions.push(import_extension_strike.Strike.configure(this.options.strike));
    }
    if (this.options.text !== false) {
      extensions.push(import_extension_text.Text.configure(this.options.text));
    }
    if (this.options.underline !== false) {
      extensions.push(import_extension_underline.Underline.configure((_c = this.options) == null ? void 0 : _c.underline));
    }
    if (this.options.trailingNode !== false) {
      extensions.push(import_extensions.TrailingNode.configure((_d = this.options) == null ? void 0 : _d.trailingNode));
    }
    return extensions;
  }
});

// src/index.ts
var index_default = StarterKit;
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  StarterKit
});
//# sourceMappingURL=index.cjs.map