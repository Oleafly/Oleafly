// src/paragraph.ts
import { mergeAttributes, Node } from "@tiptap/core";
var EMPTY_PARAGRAPH_MARKDOWN = "&nbsp;";
var NBSP_CHAR = "\xA0";
var Paragraph = Node.create({
  name: "paragraph",
  priority: 1e3,
  addOptions() {
    return {
      HTMLAttributes: {}
    };
  },
  group: "block",
  content: "inline*",
  parseHTML() {
    return [{ tag: "p" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["p", mergeAttributes(this.options.HTMLAttributes, HTMLAttributes), 0];
  },
  parseMarkdown: (token, helpers) => {
    const tokens = token.tokens || [];
    if (tokens.length === 1 && tokens[0].type === "image") {
      return helpers.parseChildren([tokens[0]]);
    }
    const content = helpers.parseInline(tokens);
    const hasExplicitEmptyParagraphMarker = tokens.length === 1 && tokens[0].type === "text" && (tokens[0].raw === EMPTY_PARAGRAPH_MARKDOWN || tokens[0].text === EMPTY_PARAGRAPH_MARKDOWN || tokens[0].raw === NBSP_CHAR || tokens[0].text === NBSP_CHAR);
    if (hasExplicitEmptyParagraphMarker && content.length === 1 && content[0].type === "text" && (content[0].text === EMPTY_PARAGRAPH_MARKDOWN || content[0].text === NBSP_CHAR)) {
      return helpers.createNode("paragraph", void 0, []);
    }
    return helpers.createNode("paragraph", void 0, content);
  },
  renderMarkdown: (node, h, ctx) => {
    var _a, _b;
    if (!node) {
      return "";
    }
    const content = Array.isArray(node.content) ? node.content : [];
    if (content.length === 0) {
      const previousContent = Array.isArray((_a = ctx == null ? void 0 : ctx.previousNode) == null ? void 0 : _a.content) ? ctx.previousNode.content : [];
      const previousNodeIsEmptyParagraph = ((_b = ctx == null ? void 0 : ctx.previousNode) == null ? void 0 : _b.type) === "paragraph" && previousContent.length === 0;
      return previousNodeIsEmptyParagraph ? EMPTY_PARAGRAPH_MARKDOWN : "";
    }
    return h.renderChildren(content);
  },
  addCommands() {
    return {
      setParagraph: () => ({ commands }) => {
        return commands.setNode(this.name);
      }
    };
  },
  addKeyboardShortcuts() {
    return {
      "Mod-Alt-0": () => this.editor.commands.setParagraph()
    };
  }
});

// src/index.ts
var index_default = Paragraph;
export {
  Paragraph,
  index_default as default
};
//# sourceMappingURL=index.js.map