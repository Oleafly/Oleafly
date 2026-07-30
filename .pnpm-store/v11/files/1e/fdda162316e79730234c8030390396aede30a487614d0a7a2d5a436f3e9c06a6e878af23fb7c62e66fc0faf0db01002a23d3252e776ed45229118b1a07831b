(function(global, factory) {
  typeof exports === "object" && typeof module !== "undefined" ? factory(exports, require("@tiptap/core"), require("prosemirror-markdown"), require("markdown-it"), require("@tiptap/pm/model"), require("markdown-it-task-lists"), require("@tiptap/pm/state")) : typeof define === "function" && define.amd ? define(["exports", "@tiptap/core", "prosemirror-markdown", "markdown-it", "@tiptap/pm/model", "markdown-it-task-lists", "@tiptap/pm/state"], factory) : (global = typeof globalThis !== "undefined" ? globalThis : global || self, factory(global["tiptap-markdown"] = {}, global.core, global.prosemirrorMarkdown, global.markdownit, global.model, global.taskListPlugin, global.state));
})(this, function(exports2, core, prosemirrorMarkdown, markdownit, model, taskListPlugin, state) {
  "use strict";var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => {
  __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
  return value;
};

  const MarkdownTightLists = core.Extension.create({
    name: "markdownTightLists",
    addOptions: () => ({
      tight: true,
      tightClass: "tight",
      listTypes: ["bulletList", "orderedList"]
    }),
    addGlobalAttributes() {
      return [{
        types: this.options.listTypes,
        attributes: {
          tight: {
            default: this.options.tight,
            parseHTML: (element) => element.getAttribute("data-tight") === "true" || !element.querySelector("p"),
            renderHTML: (attributes) => ({
              class: attributes.tight ? this.options.tightClass : null,
              "data-tight": attributes.tight ? "true" : null
            })
          }
        }
      }];
    },
    addCommands() {
      var _this = this;
      return {
        toggleTight: function() {
          let tight = arguments.length > 0 && arguments[0] !== void 0 ? arguments[0] : null;
          return (_ref) => {
            let {
              editor,
              commands
            } = _ref;
            function toggleTight(name) {
              if (!editor.isActive(name)) {
                return false;
              }
              const attrs = editor.getAttributes(name);
              return commands.updateAttributes(name, {
                tight: tight !== null && tight !== void 0 ? tight : !(attrs !== null && attrs !== void 0 && attrs.tight)
              });
            }
            return _this.options.listTypes.some((name) => toggleTight(name));
          };
        }
      };
    }
  });
  const md = markdownit();
  function scanDelims(text, pos) {
    md.inline.State.prototype.scanDelims.call({
      src: text,
      posMax: text.length
    });
    const state2 = new md.inline.State(text, null, null, []);
    return state2.scanDelims(pos, true);
  }
  function shiftDelim(text, delim, start, offset) {
    let res = text.substring(0, start) + text.substring(start + delim.length);
    res = res.substring(0, start + offset) + delim + res.substring(start + offset);
    return res;
  }
  function trimStart(text, delim, from, to) {
    let pos = from, res = text;
    while (pos < to) {
      if (scanDelims(res, pos).can_open) {
        break;
      }
      res = shiftDelim(res, delim, pos, 1);
      pos++;
    }
    return {
      text: res,
      from: pos,
      to
    };
  }
  function trimEnd(text, delim, from, to) {
    let pos = to, res = text;
    while (pos > from) {
      if (scanDelims(res, pos).can_close) {
        break;
      }
      res = shiftDelim(res, delim, pos, -1);
      pos--;
    }
    return {
      text: res,
      from,
      to: pos
    };
  }
  function trimInline(text, delim, from, to) {
    let state2 = {
      text,
      from,
      to
    };
    state2 = trimStart(state2.text, delim, state2.from, state2.to);
    state2 = trimEnd(state2.text, delim, state2.from, state2.to);
    if (state2.to - state2.from < delim.length + 1) {
      state2.text = state2.text.substring(0, state2.from) + state2.text.substring(state2.to + delim.length);
    }
    return state2.text;
  }
  class MarkdownSerializerState extends prosemirrorMarkdown.MarkdownSerializerState {
    constructor(nodes, marks, options) {
      super(nodes, marks, options !== null && options !== void 0 ? options : {});
      __publicField(this, "inTable", false);
      this.inlines = [];
    }
    render(node, parent, index) {
      super.render(node, parent, index);
      const top = this.inlines[this.inlines.length - 1];
      if (top !== null && top !== void 0 && top.start && top !== null && top !== void 0 && top.end) {
        const {
          delimiter,
          start,
          end
        } = this.normalizeInline(top);
        this.out = trimInline(this.out, delimiter, start, end);
        this.inlines.pop();
      }
    }
    markString(mark, open, parent, index) {
      const info = this.marks[mark.type.name];
      if (info.expelEnclosingWhitespace) {
        if (open) {
          this.inlines.push({
            start: this.out.length,
            delimiter: info.open
          });
        } else {
          const top = this.inlines.pop();
          this.inlines.push({
            ...top,
            end: this.out.length
          });
        }
      }
      return super.markString(mark, open, parent, index);
    }
    normalizeInline(inline) {
      let {
        start,
        end
      } = inline;
      while (this.out.charAt(start).match(/\s/)) {
        start++;
      }
      return {
        ...inline,
        start
      };
    }
  }
  const HTMLMark = core.Mark.create({
    name: "markdownHTMLMark",
    /**
     * @return {{markdown: MarkdownMarkSpec}}
     */
    addStorage() {
      return {
        markdown: {
          serialize: {
            open(state2, mark) {
              var _getMarkTags$, _getMarkTags;
              if (!this.editor.storage.markdown.options.html) {
                console.warn(`Tiptap Markdown: "${mark.type.name}" mark is only available in html mode`);
                return "";
              }
              return (_getMarkTags$ = (_getMarkTags = getMarkTags(mark)) === null || _getMarkTags === void 0 ? void 0 : _getMarkTags[0]) !== null && _getMarkTags$ !== void 0 ? _getMarkTags$ : "";
            },
            close(state2, mark) {
              var _getMarkTags$2, _getMarkTags2;
              if (!this.editor.storage.markdown.options.html) {
                return "";
              }
              return (_getMarkTags$2 = (_getMarkTags2 = getMarkTags(mark)) === null || _getMarkTags2 === void 0 ? void 0 : _getMarkTags2[1]) !== null && _getMarkTags$2 !== void 0 ? _getMarkTags$2 : "";
            }
          },
          parse: {
            // handled by markdown-it
          }
        }
      };
    }
  });
  function getMarkTags(mark) {
    const schema = mark.type.schema;
    const node = schema.text(" ", [mark]);
    const html = core.getHTMLFromFragment(model.Fragment.from(node), schema);
    const match = html.match(/^(<.*?>) (<\/.*?>)$/);
    return match ? [match[1], match[2]] : null;
  }
  function elementFromString(value) {
    const wrappedValue = `<body>${value}</body>`;
    return new window.DOMParser().parseFromString(wrappedValue, "text/html").body;
  }
  function escapeHTML(value) {
    return value === null || value === void 0 ? void 0 : value.replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function extractElement(node) {
    const parent = node.parentElement;
    const prepend = parent.cloneNode();
    while (parent.firstChild && parent.firstChild !== node) {
      prepend.appendChild(parent.firstChild);
    }
    if (prepend.childNodes.length > 0) {
      parent.parentElement.insertBefore(prepend, parent);
    }
    parent.parentElement.insertBefore(node, parent);
    if (parent.childNodes.length === 0) {
      parent.remove();
    }
  }
  function unwrapElement(node) {
    const parent = node.parentNode;
    while (node.firstChild)
      parent.insertBefore(node.firstChild, node);
    parent.removeChild(node);
  }
  const HTMLNode = core.Node.create({
    name: "markdownHTMLNode",
    addStorage() {
      return {
        markdown: {
          serialize(state2, node, parent) {
            if (this.editor.storage.markdown.options.html) {
              state2.write(serializeHTML(node, parent));
            } else {
              console.warn(`Tiptap Markdown: "${node.type.name}" node is only available in html mode`);
              state2.write(`[${node.type.name}]`);
            }
            if (node.isBlock) {
              state2.closeBlock(node);
            }
          },
          parse: {
            // handled by markdown-it
          }
        }
      };
    }
  });
  function serializeHTML(node, parent) {
    const schema = node.type.schema;
    const html = core.getHTMLFromFragment(model.Fragment.from(node), schema);
    if (node.isBlock && (parent instanceof model.Fragment || parent.type.name === schema.topNodeType.name)) {
      return formatBlock(html);
    }
    return html;
  }
  function formatBlock(html) {
    const dom = elementFromString(html);
    const element = dom.firstElementChild;
    element.innerHTML = element.innerHTML.trim() ? `
${element.innerHTML}
` : `
`;
    return element.outerHTML;
  }
  const Blockquote = core.Node.create({
    name: "blockquote"
  });
  const Blockquote$1 = Blockquote.extend({
    /**
     * @return {{markdown: MarkdownNodeSpec}}
     */
    addStorage() {
      return {
        markdown: {
          serialize: prosemirrorMarkdown.defaultMarkdownSerializer.nodes.blockquote,
          parse: {
            // handled by markdown-it
          }
        }
      };
    }
  });
  const BulletList = core.Node.create({
    name: "bulletList"
  });
  const BulletList$1 = BulletList.extend({
    /**
     * @return {{markdown: MarkdownNodeSpec}}
     */
    addStorage() {
      return {
        markdown: {
          serialize(state2, node) {
            return state2.renderList(node, "  ", () => (this.editor.storage.markdown.options.bulletListMarker || "-") + " ");
          },
          parse: {
            // handled by markdown-it
          }
        }
      };
    }
  });
  const CodeBlock = core.Node.create({
    name: "codeBlock"
  });
  const CodeBlock$1 = CodeBlock.extend({
    /**
     * @return {{markdown: MarkdownNodeSpec}}
     */
    addStorage() {
      return {
        markdown: {
          serialize(state2, node) {
            state2.write("```" + (node.attrs.language || "") + "\n");
            state2.text(node.textContent, false);
            state2.ensureNewLine();
            state2.write("```");
            state2.closeBlock(node);
          },
          parse: {
            setup(markdownit2) {
              var _this$options$languag;
              markdownit2.set({
                langPrefix: (_this$options$languag = this.options.languageClassPrefix) !== null && _this$options$languag !== void 0 ? _this$options$languag : "language-"
              });
            },
            updateDOM(element) {
              element.innerHTML = element.innerHTML.replace(/\n<\/code><\/pre>/g, "</code></pre>");
            }
          }
        }
      };
    }
  });
  const HardBreak = core.Node.create({
    name: "hardBreak"
  });
  const HardBreak$1 = HardBreak.extend({
    /**
     * @return {{markdown: MarkdownNodeSpec}}
     */
    addStorage() {
      return {
        markdown: {
          serialize(state2, node, parent, index) {
            for (let i = index + 1; i < parent.childCount; i++)
              if (parent.child(i).type != node.type) {
                state2.write(state2.inTable ? HTMLNode.storage.markdown.serialize.call(this, state2, node, parent) : "\\\n");
                return;
              }
          },
          parse: {
            // handled by markdown-it
          }
        }
      };
    }
  });
  const Heading = core.Node.create({
    name: "heading"
  });
  const Heading$1 = Heading.extend({
    /**
     * @return {{markdown: MarkdownNodeSpec}}
     */
    addStorage() {
      return {
        markdown: {
          serialize: prosemirrorMarkdown.defaultMarkdownSerializer.nodes.heading,
          parse: {
            // handled by markdown-it
          }
        }
      };
    }
  });
  const HorizontalRule = core.Node.create({
    name: "horizontalRule"
  });
  const HorizontalRule$1 = HorizontalRule.extend({
    /**
     * @return {{markdown: MarkdownNodeSpec}}
     */
    addStorage() {
      return {
        markdown: {
          serialize: prosemirrorMarkdown.defaultMarkdownSerializer.nodes.horizontal_rule,
          parse: {
            // handled by markdown-it
          }
        }
      };
    }
  });
  const Image = core.Node.create({
    name: "image"
  });
  const Image$1 = Image.extend({
    /**
     * @return {{markdown: MarkdownNodeSpec}}
     */
    addStorage() {
      return {
        markdown: {
          serialize: prosemirrorMarkdown.defaultMarkdownSerializer.nodes.image,
          parse: {
            // handled by markdown-it
          }
        }
      };
    }
  });
  const ListItem = core.Node.create({
    name: "listItem"
  });
  const ListItem$1 = ListItem.extend({
    /**
     * @return {{markdown: MarkdownNodeSpec}}
     */
    addStorage() {
      return {
        markdown: {
          serialize: prosemirrorMarkdown.defaultMarkdownSerializer.nodes.list_item,
          parse: {
            // handled by markdown-it
          }
        }
      };
    }
  });
  const OrderedList = core.Node.create({
    name: "orderedList"
  });
  function findIndexOfAdjacentNode(node, parent, index) {
    let i = 0;
    for (; index - i > 0; i++) {
      if (parent.child(index - i - 1).type.name !== node.type.name) {
        break;
      }
    }
    return i;
  }
  const OrderedList$1 = OrderedList.extend({
    /**
     * @return {{markdown: MarkdownNodeSpec}}
     */
    addStorage() {
      return {
        markdown: {
          serialize(state2, node, parent, index) {
            const start = node.attrs.start || 1;
            const maxW = String(start + node.childCount - 1).length;
            const space = state2.repeat(" ", maxW + 2);
            const adjacentIndex = findIndexOfAdjacentNode(node, parent, index);
            const separator = adjacentIndex % 2 ? ") " : ". ";
            state2.renderList(node, space, (i) => {
              const nStr = String(start + i);
              return state2.repeat(" ", maxW - nStr.length) + nStr + separator;
            });
          },
          parse: {
            // handled by markdown-it
          }
        }
      };
    }
  });
  const Paragraph = core.Node.create({
    name: "paragraph"
  });
  const Paragraph$1 = Paragraph.extend({
    /**
     * @return {{markdown: MarkdownNodeSpec}}
     */
    addStorage() {
      return {
        markdown: {
          serialize: prosemirrorMarkdown.defaultMarkdownSerializer.nodes.paragraph,
          parse: {
            // handled by markdown-it
          }
        }
      };
    }
  });
  function childNodes(node) {
    var _node$content$content, _node$content;
    return (_node$content$content = node === null || node === void 0 || (_node$content = node.content) === null || _node$content === void 0 ? void 0 : _node$content.content) !== null && _node$content$content !== void 0 ? _node$content$content : [];
  }
  const Table = core.Node.create({
    name: "table"
  });
  const Table$1 = Table.extend({
    /**
     * @return {{markdown: MarkdownNodeSpec}}
     */
    addStorage() {
      return {
        markdown: {
          serialize(state2, node, parent) {
            if (!isMarkdownSerializable(node)) {
              HTMLNode.storage.markdown.serialize.call(this, state2, node, parent);
              return;
            }
            state2.inTable = true;
            node.forEach((row, p, i) => {
              state2.write("| ");
              row.forEach((col, p2, j) => {
                if (j) {
                  state2.write(" | ");
                }
                const cellContent = col.firstChild;
                if (cellContent.textContent.trim()) {
                  state2.renderInline(cellContent);
                }
              });
              state2.write(" |");
              state2.ensureNewLine();
              if (!i) {
                const delimiterRow = Array.from({
                  length: row.childCount
                }).map(() => "---").join(" | ");
                state2.write(`| ${delimiterRow} |`);
                state2.ensureNewLine();
              }
            });
            state2.closeBlock(node);
            state2.inTable = false;
          },
          parse: {
            // handled by markdown-it
          }
        }
      };
    }
  });
  function hasSpan(node) {
    return node.attrs.colspan > 1 || node.attrs.rowspan > 1;
  }
  function isMarkdownSerializable(node) {
    const rows = childNodes(node);
    const firstRow = rows[0];
    const bodyRows = rows.slice(1);
    if (childNodes(firstRow).some((cell) => cell.type.name !== "tableHeader" || hasSpan(cell) || cell.childCount > 1)) {
      return false;
    }
    if (bodyRows.some((row) => childNodes(row).some((cell) => cell.type.name === "tableHeader" || hasSpan(cell) || cell.childCount > 1))) {
      return false;
    }
    return true;
  }
  const TaskItem = core.Node.create({
    name: "taskItem"
  });
  const TaskItem$1 = TaskItem.extend({
    /**
     * @return {{markdown: MarkdownNodeSpec}}
     */
    addStorage() {
      return {
        markdown: {
          serialize(state2, node) {
            const check = node.attrs.checked ? "[x]" : "[ ]";
            state2.write(`${check} `);
            state2.renderContent(node);
          },
          parse: {
            updateDOM(element) {
              [...element.querySelectorAll(".task-list-item")].forEach((item) => {
                const input = item.querySelector("input");
                item.setAttribute("data-type", "taskItem");
                if (input) {
                  item.setAttribute("data-checked", input.checked);
                  input.remove();
                }
              });
            }
          }
        }
      };
    }
  });
  const TaskList = core.Node.create({
    name: "taskList"
  });
  const TaskList$1 = TaskList.extend({
    /**
     * @return {{markdown: MarkdownNodeSpec}}
     */
    addStorage() {
      return {
        markdown: {
          serialize: BulletList$1.storage.markdown.serialize,
          parse: {
            setup(markdownit2) {
              markdownit2.use(taskListPlugin);
            },
            updateDOM(element) {
              [...element.querySelectorAll(".contains-task-list")].forEach((list) => {
                list.setAttribute("data-type", "taskList");
              });
            }
          }
        }
      };
    }
  });
  const Text = core.Node.create({
    name: "text"
  });
  const Text$1 = Text.extend({
    /**
     * @return {{markdown: MarkdownNodeSpec}}
     */
    addStorage() {
      return {
        markdown: {
          serialize(state2, node) {
            state2.text(escapeHTML(node.text));
          },
          parse: {
            // handled by markdown-it
          }
        }
      };
    }
  });
  const Bold = core.Mark.create({
    name: "bold"
  });
  const Bold$1 = Bold.extend({
    /**
     * @return {{markdown: MarkdownMarkSpec}}
     */
    addStorage() {
      return {
        markdown: {
          serialize: prosemirrorMarkdown.defaultMarkdownSerializer.marks.strong,
          parse: {
            // handled by markdown-it
          }
        }
      };
    }
  });
  const Code = core.Mark.create({
    name: "code"
  });
  const Code$1 = Code.extend({
    /**
     * @return {{markdown: MarkdownMarkSpec}}
     */
    addStorage() {
      return {
        markdown: {
          serialize: prosemirrorMarkdown.defaultMarkdownSerializer.marks.code,
          parse: {
            // handled by markdown-it
          }
        }
      };
    }
  });
  const Italic = core.Mark.create({
    name: "italic"
  });
  const Italic$1 = Italic.extend({
    /**
     * @return {{markdown: MarkdownMarkSpec}}
     */
    addStorage() {
      return {
        markdown: {
          serialize: prosemirrorMarkdown.defaultMarkdownSerializer.marks.em,
          parse: {
            // handled by markdown-it
          }
        }
      };
    }
  });
  const Link = core.Mark.create({
    name: "link"
  });
  const Link$1 = Link.extend({
    /**
     * @return {{markdown: MarkdownMarkSpec}}
     */
    addStorage() {
      return {
        markdown: {
          serialize: prosemirrorMarkdown.defaultMarkdownSerializer.marks.link,
          parse: {
            // handled by markdown-it
          }
        }
      };
    }
  });
  const Strike = core.Mark.create({
    name: "strike"
  });
  const Strike$1 = Strike.extend({
    /**
     * @return {{markdown: MarkdownMarkSpec}}
     */
    addStorage() {
      return {
        markdown: {
          serialize: {
            open: "~~",
            close: "~~",
            expelEnclosingWhitespace: true
          },
          parse: {
            // handled by markdown-it
          }
        }
      };
    }
  });
  const markdownExtensions = [Blockquote$1, BulletList$1, CodeBlock$1, HardBreak$1, Heading$1, HorizontalRule$1, HTMLNode, Image$1, ListItem$1, OrderedList$1, Paragraph$1, Table$1, TaskItem$1, TaskList$1, Text$1, Bold$1, Code$1, HTMLMark, Italic$1, Link$1, Strike$1];
  function getMarkdownSpec(extension) {
    var _extension$storage, _markdownExtensions$f;
    const markdownSpec = (_extension$storage = extension.storage) === null || _extension$storage === void 0 ? void 0 : _extension$storage.markdown;
    const defaultMarkdownSpec = (_markdownExtensions$f = markdownExtensions.find((e) => e.name === extension.name)) === null || _markdownExtensions$f === void 0 ? void 0 : _markdownExtensions$f.storage.markdown;
    if (markdownSpec || defaultMarkdownSpec) {
      return {
        ...defaultMarkdownSpec,
        ...markdownSpec
      };
    }
    return null;
  }
  class MarkdownSerializer {
    constructor(editor) {
      /**
       * @type {import('@tiptap/core').Editor}
       */
      __publicField(this, "editor", null);
      this.editor = editor;
    }
    serialize(content) {
      const state2 = new MarkdownSerializerState(this.nodes, this.marks, {
        hardBreakNodeName: HardBreak$1.name
      });
      state2.renderContent(content);
      return state2.out;
    }
    get nodes() {
      var _this$editor$extensio;
      return {
        ...Object.fromEntries(Object.keys(this.editor.schema.nodes).map((name) => [name, this.serializeNode(HTMLNode)])),
        ...Object.fromEntries((_this$editor$extensio = this.editor.extensionManager.extensions.filter((extension) => extension.type === "node" && this.serializeNode(extension)).map((extension) => [extension.name, this.serializeNode(extension)])) !== null && _this$editor$extensio !== void 0 ? _this$editor$extensio : [])
      };
    }
    get marks() {
      var _this$editor$extensio2;
      return {
        ...Object.fromEntries(Object.keys(this.editor.schema.marks).map((name) => [name, this.serializeMark(HTMLMark)])),
        ...Object.fromEntries((_this$editor$extensio2 = this.editor.extensionManager.extensions.filter((extension) => extension.type === "mark" && this.serializeMark(extension)).map((extension) => [extension.name, this.serializeMark(extension)])) !== null && _this$editor$extensio2 !== void 0 ? _this$editor$extensio2 : [])
      };
    }
    serializeNode(node) {
      var _getMarkdownSpec;
      return (_getMarkdownSpec = getMarkdownSpec(node)) === null || _getMarkdownSpec === void 0 || (_getMarkdownSpec = _getMarkdownSpec.serialize) === null || _getMarkdownSpec === void 0 ? void 0 : _getMarkdownSpec.bind({
        editor: this.editor,
        options: node.options
      });
    }
    serializeMark(mark) {
      var _getMarkdownSpec2;
      const serialize = (_getMarkdownSpec2 = getMarkdownSpec(mark)) === null || _getMarkdownSpec2 === void 0 ? void 0 : _getMarkdownSpec2.serialize;
      return serialize ? {
        ...serialize,
        open: typeof serialize.open === "function" ? serialize.open.bind({
          editor: this.editor,
          options: mark.options
        }) : serialize.open,
        close: typeof serialize.close === "function" ? serialize.close.bind({
          editor: this.editor,
          options: mark.options
        }) : serialize.close
      } : null;
    }
  }
  class MarkdownParser {
    constructor(editor, _ref) {
      /**
       * @type {import('@tiptap/core').Editor}
       */
      __publicField(this, "editor", null);
      /**
       * @type {markdownit}
       */
      __publicField(this, "md", null);
      let {
        html,
        linkify,
        breaks
      } = _ref;
      this.editor = editor;
      this.md = this.withPatchedRenderer(markdownit({
        html,
        linkify,
        breaks
      }));
    }
    parse(content) {
      let {
        inline
      } = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : {};
      if (typeof content === "string") {
        this.editor.extensionManager.extensions.forEach((extension) => {
          var _getMarkdownSpec;
          return (_getMarkdownSpec = getMarkdownSpec(extension)) === null || _getMarkdownSpec === void 0 || (_getMarkdownSpec = _getMarkdownSpec.parse) === null || _getMarkdownSpec === void 0 || (_getMarkdownSpec = _getMarkdownSpec.setup) === null || _getMarkdownSpec === void 0 ? void 0 : _getMarkdownSpec.call({
            editor: this.editor,
            options: extension.options
          }, this.md);
        });
        const renderedHTML = this.md.render(content);
        const element = elementFromString(renderedHTML);
        this.editor.extensionManager.extensions.forEach((extension) => {
          var _getMarkdownSpec2;
          return (_getMarkdownSpec2 = getMarkdownSpec(extension)) === null || _getMarkdownSpec2 === void 0 || (_getMarkdownSpec2 = _getMarkdownSpec2.parse) === null || _getMarkdownSpec2 === void 0 || (_getMarkdownSpec2 = _getMarkdownSpec2.updateDOM) === null || _getMarkdownSpec2 === void 0 ? void 0 : _getMarkdownSpec2.call({
            editor: this.editor,
            options: extension.options
          }, element);
        });
        this.normalizeDOM(element, {
          inline,
          content
        });
        return element.innerHTML;
      }
      return content;
    }
    normalizeDOM(node, _ref2) {
      let {
        inline,
        content
      } = _ref2;
      this.normalizeBlocks(node);
      node.querySelectorAll("*").forEach((el) => {
        var _el$nextSibling;
        if (((_el$nextSibling = el.nextSibling) === null || _el$nextSibling === void 0 ? void 0 : _el$nextSibling.nodeType) === Node.TEXT_NODE && !el.closest("pre")) {
          el.nextSibling.textContent = el.nextSibling.textContent.replace(/^\n/, "");
        }
      });
      if (inline) {
        this.normalizeInline(node, content);
      }
      return node;
    }
    normalizeBlocks(node) {
      const blocks = Object.values(this.editor.schema.nodes).filter((node2) => node2.isBlock);
      const selector = blocks.map((block) => {
        var _block$spec$parseDOM;
        return (_block$spec$parseDOM = block.spec.parseDOM) === null || _block$spec$parseDOM === void 0 ? void 0 : _block$spec$parseDOM.map((spec) => spec.tag);
      }).flat().filter(Boolean).join(",");
      if (!selector) {
        return;
      }
      [...node.querySelectorAll(selector)].forEach((el) => {
        if (el.parentElement.matches("p")) {
          extractElement(el);
        }
      });
    }
    normalizeInline(node, content) {
      var _node$firstElementChi;
      if ((_node$firstElementChi = node.firstElementChild) !== null && _node$firstElementChi !== void 0 && _node$firstElementChi.matches("p")) {
        var _content$match$, _content$match, _content$match$2, _content$match2;
        const firstParagraph = node.firstElementChild;
        const {
          nextElementSibling
        } = firstParagraph;
        const startSpaces = (_content$match$ = (_content$match = content.match(/^\s+/)) === null || _content$match === void 0 ? void 0 : _content$match[0]) !== null && _content$match$ !== void 0 ? _content$match$ : "";
        const endSpaces = !nextElementSibling ? (_content$match$2 = (_content$match2 = content.match(/\s+$/)) === null || _content$match2 === void 0 ? void 0 : _content$match2[0]) !== null && _content$match$2 !== void 0 ? _content$match$2 : "" : "";
        if (content.match(/^\n\n/)) {
          firstParagraph.innerHTML = `${firstParagraph.innerHTML}${endSpaces}`;
          return;
        }
        unwrapElement(firstParagraph);
        node.innerHTML = `${startSpaces}${node.innerHTML}${endSpaces}`;
      }
    }
    /**
     * @param {markdownit} md
     */
    withPatchedRenderer(md2) {
      const withoutNewLine = (renderer) => function() {
        const rendered = renderer(...arguments);
        if (rendered === "\n") {
          return rendered;
        }
        if (rendered[rendered.length - 1] === "\n") {
          return rendered.slice(0, -1);
        }
        return rendered;
      };
      md2.renderer.rules.hardbreak = withoutNewLine(md2.renderer.rules.hardbreak);
      md2.renderer.rules.softbreak = withoutNewLine(md2.renderer.rules.softbreak);
      md2.renderer.rules.fence = withoutNewLine(md2.renderer.rules.fence);
      md2.renderer.rules.code_block = withoutNewLine(md2.renderer.rules.code_block);
      md2.renderer.renderToken = withoutNewLine(md2.renderer.renderToken.bind(md2.renderer));
      return md2;
    }
  }
  const MarkdownClipboard = core.Extension.create({
    name: "markdownClipboard",
    addOptions() {
      return {
        transformPastedText: false,
        transformCopiedText: false
      };
    },
    addProseMirrorPlugins() {
      return [new state.Plugin({
        key: new state.PluginKey("markdownClipboard"),
        props: {
          clipboardTextParser: (text, context, plainText) => {
            if (plainText || !this.options.transformPastedText) {
              return null;
            }
            const parsed = this.editor.storage.markdown.parser.parse(text, {
              inline: true
            });
            return model.DOMParser.fromSchema(this.editor.schema).parseSlice(elementFromString(parsed), {
              preserveWhitespace: true,
              context
            });
          },
          /**
           * @param {import('prosemirror-model').Slice} slice
           */
          clipboardTextSerializer: (slice) => {
            if (!this.options.transformCopiedText) {
              return null;
            }
            return this.editor.storage.markdown.serializer.serialize(slice.content);
          }
        }
      })];
    }
  });
  const Markdown = core.Extension.create({
    name: "markdown",
    priority: 50,
    addOptions() {
      return {
        html: true,
        tightLists: true,
        tightListClass: "tight",
        bulletListMarker: "-",
        linkify: false,
        breaks: false,
        transformPastedText: false,
        transformCopiedText: false
      };
    },
    addCommands() {
      const commands = core.extensions.Commands.config.addCommands();
      return {
        setContent: (content, options) => (props) => {
          return commands.setContent(props.editor.storage.markdown.parser.parse(content), options)(props);
        },
        insertContentAt: (range, content, options) => (props) => {
          return commands.insertContentAt(range, props.editor.storage.markdown.parser.parse(content, {
            inline: true
          }), options)(props);
        }
      };
    },
    onBeforeCreate() {
      this.editor.storage.markdown = {
        options: {
          ...this.options
        },
        parser: new MarkdownParser(this.editor, this.options),
        serializer: new MarkdownSerializer(this.editor),
        getMarkdown: () => {
          return this.editor.storage.markdown.serializer.serialize(this.editor.state.doc);
        }
      };
      this.editor.options.initialContent = this.editor.options.content;
      this.editor.options.content = this.editor.storage.markdown.parser.parse(this.editor.options.content);
    },
    onCreate() {
      this.editor.options.content = this.editor.options.initialContent;
      delete this.editor.options.initialContent;
    },
    addStorage() {
      return {
        /// storage will be defined in onBeforeCreate() to prevent initial object overriding
      };
    },
    addExtensions() {
      return [MarkdownTightLists.configure({
        tight: this.options.tightLists,
        tightClass: this.options.tightListClass
      }), MarkdownClipboard.configure({
        transformPastedText: this.options.transformPastedText,
        transformCopiedText: this.options.transformCopiedText
      })];
    }
  });
  exports2.Markdown = Markdown;
  Object.defineProperty(exports2, Symbol.toStringTag, { value: "Module" });
});
//# sourceMappingURL=tiptap-markdown.umd.js.map
