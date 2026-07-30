var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => {
  __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
  return value;
};
import { Extension, Mark, getHTMLFromFragment, Node as Node$1, extensions } from "@tiptap/core";
import { MarkdownSerializerState as MarkdownSerializerState$1, defaultMarkdownSerializer } from "prosemirror-markdown";
import markdownit from "markdown-it";
import { Fragment, DOMParser } from "@tiptap/pm/model";
import taskListPlugin from "markdown-it-task-lists";
import { Plugin, PluginKey } from "@tiptap/pm/state";
const MarkdownTightLists = Extension.create({
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
  const state = new md.inline.State(text, null, null, []);
  return state.scanDelims(pos, true);
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
  let state = {
    text,
    from,
    to
  };
  state = trimStart(state.text, delim, state.from, state.to);
  state = trimEnd(state.text, delim, state.from, state.to);
  if (state.to - state.from < delim.length + 1) {
    state.text = state.text.substring(0, state.from) + state.text.substring(state.to + delim.length);
  }
  return state.text;
}
class MarkdownSerializerState extends MarkdownSerializerState$1 {
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
const HTMLMark = Mark.create({
  name: "markdownHTMLMark",
  /**
   * @return {{markdown: MarkdownMarkSpec}}
   */
  addStorage() {
    return {
      markdown: {
        serialize: {
          open(state, mark) {
            var _getMarkTags$, _getMarkTags;
            if (!this.editor.storage.markdown.options.html) {
              console.warn(`Tiptap Markdown: "${mark.type.name}" mark is only available in html mode`);
              return "";
            }
            return (_getMarkTags$ = (_getMarkTags = getMarkTags(mark)) === null || _getMarkTags === void 0 ? void 0 : _getMarkTags[0]) !== null && _getMarkTags$ !== void 0 ? _getMarkTags$ : "";
          },
          close(state, mark) {
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
  const html = getHTMLFromFragment(Fragment.from(node), schema);
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
const HTMLNode = Node$1.create({
  name: "markdownHTMLNode",
  addStorage() {
    return {
      markdown: {
        serialize(state, node, parent) {
          if (this.editor.storage.markdown.options.html) {
            state.write(serializeHTML(node, parent));
          } else {
            console.warn(`Tiptap Markdown: "${node.type.name}" node is only available in html mode`);
            state.write(`[${node.type.name}]`);
          }
          if (node.isBlock) {
            state.closeBlock(node);
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
  const html = getHTMLFromFragment(Fragment.from(node), schema);
  if (node.isBlock && (parent instanceof Fragment || parent.type.name === schema.topNodeType.name)) {
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
const Blockquote = Node$1.create({
  name: "blockquote"
});
const Blockquote$1 = Blockquote.extend({
  /**
   * @return {{markdown: MarkdownNodeSpec}}
   */
  addStorage() {
    return {
      markdown: {
        serialize: defaultMarkdownSerializer.nodes.blockquote,
        parse: {
          // handled by markdown-it
        }
      }
    };
  }
});
const BulletList = Node$1.create({
  name: "bulletList"
});
const BulletList$1 = BulletList.extend({
  /**
   * @return {{markdown: MarkdownNodeSpec}}
   */
  addStorage() {
    return {
      markdown: {
        serialize(state, node) {
          return state.renderList(node, "  ", () => (this.editor.storage.markdown.options.bulletListMarker || "-") + " ");
        },
        parse: {
          // handled by markdown-it
        }
      }
    };
  }
});
const CodeBlock = Node$1.create({
  name: "codeBlock"
});
const CodeBlock$1 = CodeBlock.extend({
  /**
   * @return {{markdown: MarkdownNodeSpec}}
   */
  addStorage() {
    return {
      markdown: {
        serialize(state, node) {
          state.write("```" + (node.attrs.language || "") + "\n");
          state.text(node.textContent, false);
          state.ensureNewLine();
          state.write("```");
          state.closeBlock(node);
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
const HardBreak = Node$1.create({
  name: "hardBreak"
});
const HardBreak$1 = HardBreak.extend({
  /**
   * @return {{markdown: MarkdownNodeSpec}}
   */
  addStorage() {
    return {
      markdown: {
        serialize(state, node, parent, index) {
          for (let i = index + 1; i < parent.childCount; i++)
            if (parent.child(i).type != node.type) {
              state.write(state.inTable ? HTMLNode.storage.markdown.serialize.call(this, state, node, parent) : "\\\n");
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
const Heading = Node$1.create({
  name: "heading"
});
const Heading$1 = Heading.extend({
  /**
   * @return {{markdown: MarkdownNodeSpec}}
   */
  addStorage() {
    return {
      markdown: {
        serialize: defaultMarkdownSerializer.nodes.heading,
        parse: {
          // handled by markdown-it
        }
      }
    };
  }
});
const HorizontalRule = Node$1.create({
  name: "horizontalRule"
});
const HorizontalRule$1 = HorizontalRule.extend({
  /**
   * @return {{markdown: MarkdownNodeSpec}}
   */
  addStorage() {
    return {
      markdown: {
        serialize: defaultMarkdownSerializer.nodes.horizontal_rule,
        parse: {
          // handled by markdown-it
        }
      }
    };
  }
});
const Image = Node$1.create({
  name: "image"
});
const Image$1 = Image.extend({
  /**
   * @return {{markdown: MarkdownNodeSpec}}
   */
  addStorage() {
    return {
      markdown: {
        serialize: defaultMarkdownSerializer.nodes.image,
        parse: {
          // handled by markdown-it
        }
      }
    };
  }
});
const ListItem = Node$1.create({
  name: "listItem"
});
const ListItem$1 = ListItem.extend({
  /**
   * @return {{markdown: MarkdownNodeSpec}}
   */
  addStorage() {
    return {
      markdown: {
        serialize: defaultMarkdownSerializer.nodes.list_item,
        parse: {
          // handled by markdown-it
        }
      }
    };
  }
});
const OrderedList = Node$1.create({
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
        serialize(state, node, parent, index) {
          const start = node.attrs.start || 1;
          const maxW = String(start + node.childCount - 1).length;
          const space = state.repeat(" ", maxW + 2);
          const adjacentIndex = findIndexOfAdjacentNode(node, parent, index);
          const separator = adjacentIndex % 2 ? ") " : ". ";
          state.renderList(node, space, (i) => {
            const nStr = String(start + i);
            return state.repeat(" ", maxW - nStr.length) + nStr + separator;
          });
        },
        parse: {
          // handled by markdown-it
        }
      }
    };
  }
});
const Paragraph = Node$1.create({
  name: "paragraph"
});
const Paragraph$1 = Paragraph.extend({
  /**
   * @return {{markdown: MarkdownNodeSpec}}
   */
  addStorage() {
    return {
      markdown: {
        serialize: defaultMarkdownSerializer.nodes.paragraph,
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
const Table = Node$1.create({
  name: "table"
});
const Table$1 = Table.extend({
  /**
   * @return {{markdown: MarkdownNodeSpec}}
   */
  addStorage() {
    return {
      markdown: {
        serialize(state, node, parent) {
          if (!isMarkdownSerializable(node)) {
            HTMLNode.storage.markdown.serialize.call(this, state, node, parent);
            return;
          }
          state.inTable = true;
          node.forEach((row, p, i) => {
            state.write("| ");
            row.forEach((col, p2, j) => {
              if (j) {
                state.write(" | ");
              }
              const cellContent = col.firstChild;
              if (cellContent.textContent.trim()) {
                state.renderInline(cellContent);
              }
            });
            state.write(" |");
            state.ensureNewLine();
            if (!i) {
              const delimiterRow = Array.from({
                length: row.childCount
              }).map(() => "---").join(" | ");
              state.write(`| ${delimiterRow} |`);
              state.ensureNewLine();
            }
          });
          state.closeBlock(node);
          state.inTable = false;
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
const TaskItem = Node$1.create({
  name: "taskItem"
});
const TaskItem$1 = TaskItem.extend({
  /**
   * @return {{markdown: MarkdownNodeSpec}}
   */
  addStorage() {
    return {
      markdown: {
        serialize(state, node) {
          const check = node.attrs.checked ? "[x]" : "[ ]";
          state.write(`${check} `);
          state.renderContent(node);
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
const TaskList = Node$1.create({
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
const Text = Node$1.create({
  name: "text"
});
const Text$1 = Text.extend({
  /**
   * @return {{markdown: MarkdownNodeSpec}}
   */
  addStorage() {
    return {
      markdown: {
        serialize(state, node) {
          state.text(escapeHTML(node.text));
        },
        parse: {
          // handled by markdown-it
        }
      }
    };
  }
});
const Bold = Mark.create({
  name: "bold"
});
const Bold$1 = Bold.extend({
  /**
   * @return {{markdown: MarkdownMarkSpec}}
   */
  addStorage() {
    return {
      markdown: {
        serialize: defaultMarkdownSerializer.marks.strong,
        parse: {
          // handled by markdown-it
        }
      }
    };
  }
});
const Code = Mark.create({
  name: "code"
});
const Code$1 = Code.extend({
  /**
   * @return {{markdown: MarkdownMarkSpec}}
   */
  addStorage() {
    return {
      markdown: {
        serialize: defaultMarkdownSerializer.marks.code,
        parse: {
          // handled by markdown-it
        }
      }
    };
  }
});
const Italic = Mark.create({
  name: "italic"
});
const Italic$1 = Italic.extend({
  /**
   * @return {{markdown: MarkdownMarkSpec}}
   */
  addStorage() {
    return {
      markdown: {
        serialize: defaultMarkdownSerializer.marks.em,
        parse: {
          // handled by markdown-it
        }
      }
    };
  }
});
const Link = Mark.create({
  name: "link"
});
const Link$1 = Link.extend({
  /**
   * @return {{markdown: MarkdownMarkSpec}}
   */
  addStorage() {
    return {
      markdown: {
        serialize: defaultMarkdownSerializer.marks.link,
        parse: {
          // handled by markdown-it
        }
      }
    };
  }
});
const Strike = Mark.create({
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
    const state = new MarkdownSerializerState(this.nodes, this.marks, {
      hardBreakNodeName: HardBreak$1.name
    });
    state.renderContent(content);
    return state.out;
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
const MarkdownClipboard = Extension.create({
  name: "markdownClipboard",
  addOptions() {
    return {
      transformPastedText: false,
      transformCopiedText: false
    };
  },
  addProseMirrorPlugins() {
    return [new Plugin({
      key: new PluginKey("markdownClipboard"),
      props: {
        clipboardTextParser: (text, context, plainText) => {
          if (plainText || !this.options.transformPastedText) {
            return null;
          }
          const parsed = this.editor.storage.markdown.parser.parse(text, {
            inline: true
          });
          return DOMParser.fromSchema(this.editor.schema).parseSlice(elementFromString(parsed), {
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
const Markdown = Extension.create({
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
    const commands = extensions.Commands.config.addCommands();
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
export {
  Markdown
};
//# sourceMappingURL=tiptap-markdown.es.js.map
