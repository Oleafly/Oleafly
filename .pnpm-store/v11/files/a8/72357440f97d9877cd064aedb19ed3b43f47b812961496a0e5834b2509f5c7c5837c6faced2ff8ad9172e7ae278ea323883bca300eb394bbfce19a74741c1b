// src/heading.ts
import { mergeAttributes, Node, textblockTypeInputRule } from "@tiptap/core";
var Heading = Node.create({
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
    return [`h${level}`, mergeAttributes(this.options.HTMLAttributes, HTMLAttributes), 0];
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
      return textblockTypeInputRule({
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
export {
  Heading,
  index_default as default
};
//# sourceMappingURL=index.js.map