// src/code.ts
import { Mark, markInputRule, markPasteRule, mergeAttributes } from "@tiptap/core";
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
var Code = Mark.create({
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
    return ["code", mergeAttributes(this.options.HTMLAttributes, HTMLAttributes), 0];
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
      markInputRule({
        find: inputRegexMatch,
        type: this.type
      })
    ];
  },
  addPasteRules() {
    return [
      markPasteRule({
        find: pasteRegexMatch,
        type: this.type
      })
    ];
  }
});

// src/index.ts
var index_default = Code;
export {
  Code,
  index_default as default,
  inputRegex,
  inputRegexMatch,
  pasteRegex,
  pasteRegexMatch
};
//# sourceMappingURL=index.js.map