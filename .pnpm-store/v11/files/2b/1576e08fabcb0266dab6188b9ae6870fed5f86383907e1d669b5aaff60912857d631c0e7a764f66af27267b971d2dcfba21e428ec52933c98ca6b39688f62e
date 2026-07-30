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
  Heading: () => Heading,
  default: () => index_default
});
module.exports = __toCommonJS(index_exports);

// src/heading.ts
var import_core = require("@tiptap/core");
var Heading = import_core.Node.create({
  name: "heading",
  addOptions() {
    return {
      levels: [1, 2, 3, 4, 5, 6],
      HTMLAttributes: {}
    };
  },
  content: "inline*",
  group: "block",
  defining: true,
  addAttributes() {
    return {
      level: {
        default: 1,
        rendered: false
      }
    };
  },
  parseHTML() {
    return this.options.levels.map((level) => ({
      tag: `h${level}`,
      attrs: { level }
    }));
  },
  renderHTML({ node, HTMLAttributes }) {
    const hasLevel = this.options.levels.includes(node.attrs.level);
    const level = hasLevel ? node.attrs.level : this.options.levels[0];
    return [`h${level}`, (0, import_core.mergeAttributes)(this.options.HTMLAttributes, HTMLAttributes), 0];
  },
  parseMarkdown: (token, helpers) => {
    return helpers.createNode(
      "heading",
      { level: token.depth || 1 },
      helpers.parseInline(token.tokens || [])
    );
  },
  renderMarkdown: (node, h) => {
    var _a;
    const level = ((_a = node.attrs) == null ? void 0 : _a.level) ? parseInt(node.attrs.level, 10) : 1;
    const headingChars = "#".repeat(level);
    if (!node.content) {
      return "";
    }
    return `${headingChars} ${h.renderChildren(node.content)}`;
  },
  addCommands() {
    return {
      setHeading: (attributes) => ({ commands }) => {
        if (!this.options.levels.includes(attributes.level)) {
          return false;
        }
        return commands.setNode(this.name, attributes);
      },
      toggleHeading: (attributes) => ({ commands }) => {
        if (!this.options.levels.includes(attributes.level)) {
          return false;
        }
        return commands.toggleNode(this.name, "paragraph", attributes);
      }
    };
  },
  addKeyboardShortcuts() {
    return this.options.levels.reduce(
      (items, level) => ({
        ...items,
        [`Mod-Alt-${level}`]: () => this.editor.commands.toggleHeading({ level })
      }),
      {}
    );
  },
  addInputRules() {
    return this.options.levels.map((level) => {
      return (0, import_core.textblockTypeInputRule)({
        find: new RegExp(`^(#{${Math.min(...this.options.levels)},${level}})\\s$`),
        type: this.type,
        getAttributes: {
          level
        }
      });
    });
  }
});

// src/index.ts
var index_default = Heading;
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  Heading
});
//# sourceMappingURL=index.cjs.map