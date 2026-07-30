// src/task-list/task-list.ts
import { mergeAttributes, Node, parseIndentedBlocks } from "@tiptap/core";
var TaskList = Node.create({
  name: "taskList",
  addOptions() {
    return {
      itemTypeName: "taskItem",
      HTMLAttributes: {}
    };
  },
  group: "block list",
  content() {
    return `${this.options.itemTypeName}+`;
  },
  parseHTML() {
    return [
      {
        tag: `ul[data-type="${this.name}"]`,
        priority: 51
      }
    ];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "ul",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, { "data-type": this.name }),
      0
    ];
  },
  parseMarkdown: (token, h) => {
    return h.createNode("taskList", {}, h.parseChildren(token.items || []));
  },
  renderMarkdown: (node, h) => {
    if (!node.content) {
      return "";
    }
    return h.renderChildren(node.content, "\n");
  },
  markdownTokenizer: {
    name: "taskList",
    level: "block",
    start(src) {
      var _a;
      const index = (_a = src.match(/^\s*[-+*]\s+\[([ xX])\]\s+/)) == null ? void 0 : _a.index;
      return index !== void 0 ? index : -1;
    },
    tokenize(src, tokens, lexer) {
      const parseTaskListContent = (content) => {
        const nestedResult = parseIndentedBlocks(
          content,
          {
            itemPattern: /^(\s*)([-+*])\s+\[([ xX])\]\s+(.*)$/,
            extractItemData: (match) => ({
              indentLevel: match[1].length,
              mainContent: match[4],
              checked: match[3].toLowerCase() === "x"
            }),
            createToken: (data, nestedTokens) => ({
              type: "taskItem",
              raw: "",
              mainContent: data.mainContent,
              indentLevel: data.indentLevel,
              checked: data.checked,
              text: data.mainContent,
              tokens: lexer.inlineTokens(data.mainContent),
              nestedTokens
            }),
            // Allow recursive nesting
            customNestedParser: parseTaskListContent
          },
          lexer
        );
        if (nestedResult) {
          const taskListToken = {
            type: "taskList",
            raw: nestedResult.raw,
            items: nestedResult.items
          };
          const remainder = content.slice(nestedResult.raw.length);
          if (remainder.trim()) {
            return [taskListToken, ...lexer.blockTokens(remainder)];
          }
          return [taskListToken];
        }
        return lexer.blockTokens(content);
      };
      const result = parseIndentedBlocks(
        src,
        {
          itemPattern: /^(\s*)([-+*])\s+\[([ xX])\]\s+(.*)$/,
          extractItemData: (match) => ({
            indentLevel: match[1].length,
            mainContent: match[4],
            checked: match[3].toLowerCase() === "x"
          }),
          createToken: (data, nestedTokens) => ({
            type: "taskItem",
            raw: "",
            mainContent: data.mainContent,
            indentLevel: data.indentLevel,
            checked: data.checked,
            text: data.mainContent,
            tokens: lexer.inlineTokens(data.mainContent),
            nestedTokens
          }),
          // Use the recursive parser for nested content
          customNestedParser: parseTaskListContent
        },
        lexer
      );
      if (!result) {
        return void 0;
      }
      return {
        type: "taskList",
        raw: result.raw,
        items: result.items
      };
    }
  },
  markdownOptions: {
    indentsContent: true
  },
  addCommands() {
    return {
      toggleTaskList: () => ({ commands }) => {
        return commands.toggleList(this.name, this.options.itemTypeName);
      }
    };
  },
  addKeyboardShortcuts() {
    return {
      "Mod-Shift-9": () => this.editor.commands.toggleTaskList()
    };
  }
});
export {
  TaskList
};
//# sourceMappingURL=index.js.map