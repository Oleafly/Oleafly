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
  CodeBlock: () => CodeBlock,
  backtickInputRegex: () => backtickInputRegex,
  default: () => index_default,
  tildeInputRegex: () => tildeInputRegex
});
module.exports = __toCommonJS(index_exports);

// src/code-block.ts
var import_core = require("@tiptap/core");
var import_state = require("@tiptap/pm/state");
var DEFAULT_TAB_SIZE = 4;
var backtickInputRegex = /^```([a-z]+)?[\s\n]$/;
var tildeInputRegex = /^~~~([a-z]+)?[\s\n]$/;
var CodeBlock = import_core.Node.create({
  name: "codeBlock",
  addOptions() {
    return {
      languageClassPrefix: "language-",
      exitOnTripleEnter: true,
      exitOnArrowDown: true,
      defaultLanguage: null,
      enableTabIndentation: false,
      tabSize: DEFAULT_TAB_SIZE,
      HTMLAttributes: {}
    };
  },
  content: "text*",
  marks: "",
  group: "block",
  code: true,
  defining: true,
  addAttributes() {
    return {
      language: {
        default: this.options.defaultLanguage,
        parseHTML: (element) => {
          var _a;
          const { languageClassPrefix } = this.options;
          if (!languageClassPrefix) {
            return null;
          }
          const classNames = [...((_a = element.firstElementChild) == null ? void 0 : _a.classList) || []];
          const languages = classNames.filter((className) => className.startsWith(languageClassPrefix)).map((className) => className.replace(languageClassPrefix, ""));
          const language = languages[0];
          if (!language) {
            return null;
          }
          return language;
        },
        rendered: false
      }
    };
  },
  parseHTML() {
    return [
      {
        tag: "pre",
        preserveWhitespace: "full"
      }
    ];
  },
  renderHTML({ node, HTMLAttributes }) {
    return [
      "pre",
      (0, import_core.mergeAttributes)(this.options.HTMLAttributes, HTMLAttributes),
      [
        "code",
        {
          class: node.attrs.language ? this.options.languageClassPrefix + node.attrs.language : null
        },
        0
      ]
    ];
  },
  markdownTokenName: "code",
  parseMarkdown: (token, helpers) => {
    var _a, _b;
    if (((_a = token.raw) == null ? void 0 : _a.startsWith("```")) === false && ((_b = token.raw) == null ? void 0 : _b.startsWith("~~~")) === false && token.codeBlockStyle !== "indented") {
      return [];
    }
    return helpers.createNode(
      "codeBlock",
      { language: token.lang || null },
      token.text ? [helpers.createTextNode(token.text)] : []
    );
  },
  renderMarkdown: (node, h) => {
    var _a;
    let output = "";
    const language = ((_a = node.attrs) == null ? void 0 : _a.language) || "";
    if (!node.content) {
      output = `\`\`\`${language}

\`\`\``;
    } else {
      const lines = [`\`\`\`${language}`, h.renderChildren(node.content), "```"];
      output = lines.join("\n");
    }
    return output;
  },
  addCommands() {
    return {
      setCodeBlock: (attributes) => ({ commands }) => {
        return commands.setNode(this.name, attributes);
      },
      toggleCodeBlock: (attributes) => ({ commands }) => {
        return commands.toggleNode(this.name, "paragraph", attributes);
      }
    };
  },
  addKeyboardShortcuts() {
    return {
      "Mod-Alt-c": () => this.editor.commands.toggleCodeBlock(),
      // remove code block when at start of document or code block is empty
      Backspace: () => {
        const { empty, $anchor } = this.editor.state.selection;
        const isAtStart = $anchor.pos === 1;
        if (!empty || $anchor.parent.type.name !== this.name) {
          return false;
        }
        if (isAtStart || !$anchor.parent.textContent.length) {
          return this.editor.commands.clearNodes();
        }
        return false;
      },
      // handle tab indentation
      Tab: ({ editor }) => {
        var _a;
        if (!this.options.enableTabIndentation) {
          return false;
        }
        const tabSize = (_a = this.options.tabSize) != null ? _a : DEFAULT_TAB_SIZE;
        const { state } = editor;
        const { selection } = state;
        const { $from, empty } = selection;
        if ($from.parent.type !== this.type) {
          return false;
        }
        const indent = " ".repeat(tabSize);
        if (empty) {
          return editor.commands.insertContent(indent);
        }
        return editor.commands.command(({ tr }) => {
          const { from, to } = selection;
          const text = state.doc.textBetween(from, to, "\n", "\n");
          const lines = text.split("\n");
          const indentedText = lines.map((line) => indent + line).join("\n");
          tr.replaceWith(from, to, state.schema.text(indentedText));
          return true;
        });
      },
      // handle shift+tab reverse indentation
      "Shift-Tab": ({ editor }) => {
        var _a;
        if (!this.options.enableTabIndentation) {
          return false;
        }
        const tabSize = (_a = this.options.tabSize) != null ? _a : DEFAULT_TAB_SIZE;
        const { state } = editor;
        const { selection } = state;
        const { $from, empty } = selection;
        if ($from.parent.type !== this.type) {
          return false;
        }
        if (empty) {
          return editor.commands.command(({ tr }) => {
            var _a2;
            const { pos } = $from;
            const codeBlockStart = $from.start();
            const codeBlockEnd = $from.end();
            const allText = state.doc.textBetween(codeBlockStart, codeBlockEnd, "\n", "\n");
            const lines = allText.split("\n");
            let currentLineIndex = 0;
            let charCount = 0;
            const relativeCursorPos = pos - codeBlockStart;
            for (let i = 0; i < lines.length; i += 1) {
              if (charCount + lines[i].length >= relativeCursorPos) {
                currentLineIndex = i;
                break;
              }
              charCount += lines[i].length + 1;
            }
            const currentLine = lines[currentLineIndex];
            const leadingSpaces = ((_a2 = currentLine.match(/^ */)) == null ? void 0 : _a2[0]) || "";
            const spacesToRemove = Math.min(leadingSpaces.length, tabSize);
            if (spacesToRemove === 0) {
              return true;
            }
            let lineStartPos = codeBlockStart;
            for (let i = 0; i < currentLineIndex; i += 1) {
              lineStartPos += lines[i].length + 1;
            }
            tr.delete(lineStartPos, lineStartPos + spacesToRemove);
            const cursorPosInLine = pos - lineStartPos;
            if (cursorPosInLine <= spacesToRemove) {
              tr.setSelection(import_state.TextSelection.create(tr.doc, lineStartPos));
            }
            return true;
          });
        }
        return editor.commands.command(({ tr }) => {
          const { from, to } = selection;
          const text = state.doc.textBetween(from, to, "\n", "\n");
          const lines = text.split("\n");
          const reverseIndentText = lines.map((line) => {
            var _a2;
            const leadingSpaces = ((_a2 = line.match(/^ */)) == null ? void 0 : _a2[0]) || "";
            const spacesToRemove = Math.min(leadingSpaces.length, tabSize);
            return line.slice(spacesToRemove);
          }).join("\n");
          tr.replaceWith(from, to, state.schema.text(reverseIndentText));
          return true;
        });
      },
      // exit node on triple enter
      Enter: ({ editor }) => {
        if (!this.options.exitOnTripleEnter) {
          return false;
        }
        const { state } = editor;
        const { selection } = state;
        const { $from, empty } = selection;
        if (!empty || $from.parent.type !== this.type) {
          return false;
        }
        const isAtEnd = $from.parentOffset === $from.parent.nodeSize - 2;
        const endsWithDoubleNewline = $from.parent.textContent.endsWith("\n\n");
        if (!isAtEnd || !endsWithDoubleNewline) {
          return false;
        }
        return editor.chain().command(({ tr }) => {
          tr.delete($from.pos - 2, $from.pos);
          return true;
        }).exitCode().run();
      },
      // exit node on arrow down
      ArrowDown: ({ editor }) => {
        if (!this.options.exitOnArrowDown) {
          return false;
        }
        const { state } = editor;
        const { selection, doc } = state;
        const { $from, empty } = selection;
        if (!empty || $from.parent.type !== this.type) {
          return false;
        }
        const isAtEnd = $from.parentOffset === $from.parent.nodeSize - 2;
        if (!isAtEnd) {
          return false;
        }
        const after = $from.after();
        if (after === void 0) {
          return false;
        }
        const nodeAfter = doc.nodeAt(after);
        if (nodeAfter) {
          return editor.commands.command(({ tr }) => {
            tr.setSelection(import_state.Selection.near(doc.resolve(after)));
            return true;
          });
        }
        return editor.commands.exitCode();
      }
    };
  },
  addInputRules() {
    return [
      (0, import_core.textblockTypeInputRule)({
        find: backtickInputRegex,
        type: this.type,
        getAttributes: (match) => ({
          language: match[1]
        })
      }),
      (0, import_core.textblockTypeInputRule)({
        find: tildeInputRegex,
        type: this.type,
        getAttributes: (match) => ({
          language: match[1]
        })
      })
    ];
  },
  addProseMirrorPlugins() {
    return [
      // this plugin creates a code block for pasted content from VS Code
      // we can also detect the copied code language
      new import_state.Plugin({
        key: new import_state.PluginKey("codeBlockVSCodeHandler"),
        props: {
          handlePaste: (view, event) => {
            if (!event.clipboardData) {
              return false;
            }
            if (this.editor.isActive(this.type.name)) {
              return false;
            }
            const text = event.clipboardData.getData("text/plain");
            const vscode = event.clipboardData.getData("vscode-editor-data");
            const vscodeData = vscode ? JSON.parse(vscode) : void 0;
            const language = vscodeData == null ? void 0 : vscodeData.mode;
            if (!text || !language) {
              return false;
            }
            const { tr, schema } = view.state;
            const textNode = schema.text(text.replace(/\r\n?/g, "\n"));
            tr.replaceSelectionWith(this.type.create({ language }, textNode));
            if (tr.selection.$from.parent.type !== this.type) {
              tr.setSelection(
                import_state.TextSelection.near(tr.doc.resolve(Math.max(0, tr.selection.from - 2)))
              );
            }
            tr.setMeta("paste", true);
            view.dispatch(tr);
            return true;
          }
        }
      })
    ];
  }
});

// src/index.ts
var index_default = CodeBlock;
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  CodeBlock,
  backtickInputRegex,
  tildeInputRegex
});
//# sourceMappingURL=index.cjs.map