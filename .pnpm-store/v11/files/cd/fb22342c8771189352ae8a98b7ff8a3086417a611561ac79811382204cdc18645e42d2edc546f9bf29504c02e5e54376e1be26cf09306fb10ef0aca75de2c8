// src/underline.ts
import { Mark, mergeAttributes } from "@tiptap/core";
var Underline = Mark.create({
  name: "underline",
  addOptions() {
    return {
      HTMLAttributes: {}
    };
  },
  parseHTML() {
    return [
      {
        tag: "u"
      },
      {
        style: "text-decoration",
        consuming: false,
        getAttrs: (style) => style.includes("underline") ? {} : false
      }
    ];
  },
  renderHTML({ HTMLAttributes }) {
    return ["u", mergeAttributes(this.options.HTMLAttributes, HTMLAttributes), 0];
  },
  parseMarkdown(token, helpers) {
    return helpers.applyMark(this.name || "underline", helpers.parseInline(token.tokens || []));
  },
  renderMarkdown(node, helpers) {
    return `++${helpers.renderChildren(node)}++`;
  },
  markdownTokenizer: {
    name: "underline",
    level: "inline",
    start(src) {
      return src.indexOf("++");
    },
    tokenize(src, _tokens, lexer) {
      const rule = /^(\+\+)([\s\S]+?)(\+\+)/;
      const match = rule.exec(src);
      if (!match) {
        return void 0;
      }
      const innerContent = match[2].trim();
      return {
        type: "underline",
        raw: match[0],
        text: innerContent,
        tokens: lexer.inlineTokens(innerContent)
      };
    }
  },
  addCommands() {
    return {
      setUnderline: () => ({ commands }) => {
        return commands.setMark(this.name);
      },
      toggleUnderline: () => ({ commands }) => {
        return commands.toggleMark(this.name);
      },
      unsetUnderline: () => ({ commands }) => {
        return commands.unsetMark(this.name);
      }
    };
  },
  addKeyboardShortcuts() {
    return {
      "Mod-u": () => this.editor.commands.toggleUnderline(),
      "Mod-U": () => this.editor.commands.toggleUnderline()
    };
  }
});

// src/index.ts
var index_default = Underline;
export {
  Underline,
  index_default as default
};
//# sourceMappingURL=index.js.map