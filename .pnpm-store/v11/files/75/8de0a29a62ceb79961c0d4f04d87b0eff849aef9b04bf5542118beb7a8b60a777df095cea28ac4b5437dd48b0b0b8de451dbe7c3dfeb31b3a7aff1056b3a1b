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
  Link: () => Link,
  default: () => index_default,
  isAllowedUri: () => isAllowedUri,
  pasteRegex: () => pasteRegex
});
module.exports = __toCommonJS(index_exports);

// src/link.ts
var import_core3 = require("@tiptap/core");
var import_linkifyjs3 = require("linkifyjs");

// src/helpers/autolink.ts
var import_core = require("@tiptap/core");
var import_state = require("@tiptap/pm/state");
var import_linkifyjs = require("linkifyjs");

// src/helpers/whitespace.ts
var UNICODE_WHITESPACE_PATTERN = "[\0- \xA0\u1680\u180E\u2000-\u2029\u205F\u3000]";
var UNICODE_WHITESPACE_REGEX = new RegExp(UNICODE_WHITESPACE_PATTERN);
var UNICODE_WHITESPACE_REGEX_END = new RegExp(`${UNICODE_WHITESPACE_PATTERN}$`);
var UNICODE_WHITESPACE_REGEX_GLOBAL = new RegExp(UNICODE_WHITESPACE_PATTERN, "g");

// src/helpers/autolink.ts
function isValidLinkStructure(tokens) {
  if (tokens.length === 1) {
    return tokens[0].isLink;
  }
  if (tokens.length === 3 && tokens[1].isLink) {
    return ["()", "[]"].includes(tokens[0].value + tokens[2].value);
  }
  return false;
}
function autolink(options) {
  return new import_state.Plugin({
    key: new import_state.PluginKey("autolink"),
    appendTransaction: (transactions, oldState, newState) => {
      const docChanges = transactions.some((transaction) => transaction.docChanged) && !oldState.doc.eq(newState.doc);
      const preventAutolink = transactions.some(
        (transaction) => transaction.getMeta("preventAutolink")
      );
      if (!docChanges || preventAutolink) {
        return;
      }
      const { tr } = newState;
      const transform = (0, import_core.combineTransactionSteps)(oldState.doc, [...transactions]);
      const changes = (0, import_core.getChangedRanges)(transform);
      changes.forEach(({ newRange }) => {
        const nodesInChangedRanges = (0, import_core.findChildrenInRange)(
          newState.doc,
          newRange,
          (node) => node.isTextblock
        );
        let textBlock;
        let textBeforeWhitespace;
        if (nodesInChangedRanges.length > 1) {
          textBlock = nodesInChangedRanges[0];
          textBeforeWhitespace = newState.doc.textBetween(
            textBlock.pos,
            textBlock.pos + textBlock.node.nodeSize,
            void 0,
            " "
          );
        } else if (nodesInChangedRanges.length) {
          const endText = newState.doc.textBetween(newRange.from, newRange.to, " ", " ");
          if (!UNICODE_WHITESPACE_REGEX_END.test(endText)) {
            return;
          }
          textBlock = nodesInChangedRanges[0];
          textBeforeWhitespace = newState.doc.textBetween(
            textBlock.pos,
            newRange.to,
            void 0,
            " "
          );
        }
        if (textBlock && textBeforeWhitespace) {
          const wordsBeforeWhitespace = textBeforeWhitespace.split(UNICODE_WHITESPACE_REGEX).filter(Boolean);
          if (wordsBeforeWhitespace.length <= 0) {
            return false;
          }
          const lastWordBeforeSpace = wordsBeforeWhitespace[wordsBeforeWhitespace.length - 1];
          const lastWordAndBlockOffset = textBlock.pos + textBeforeWhitespace.lastIndexOf(lastWordBeforeSpace);
          if (!lastWordBeforeSpace) {
            return false;
          }
          const linksBeforeSpace = (0, import_linkifyjs.tokenize)(lastWordBeforeSpace).map(
            (t) => t.toObject(options.defaultProtocol)
          );
          if (!isValidLinkStructure(linksBeforeSpace)) {
            return false;
          }
          linksBeforeSpace.filter((link) => link.isLink).map((link) => ({
            ...link,
            from: lastWordAndBlockOffset + link.start + 1,
            to: lastWordAndBlockOffset + link.end + 1
          })).filter((link) => {
            if (!newState.schema.marks.code) {
              return true;
            }
            return !newState.doc.rangeHasMark(link.from, link.to, newState.schema.marks.code);
          }).filter((link) => options.validate(link.value)).filter((link) => options.shouldAutoLink(link.value)).forEach((link) => {
            if ((0, import_core.getMarksBetween)(link.from, link.to, newState.doc).some(
              (item) => item.mark.type === options.type
            )) {
              return;
            }
            tr.addMark(
              link.from,
              link.to,
              options.type.create({
                href: link.href
              })
            );
          });
        }
      });
      if (!tr.steps.length) {
        return;
      }
      return tr;
    }
  });
}

// src/helpers/clickHandler.ts
var import_core2 = require("@tiptap/core");
var import_state2 = require("@tiptap/pm/state");
function clickHandler(options) {
  return new import_state2.Plugin({
    key: new import_state2.PluginKey("handleClickLink"),
    props: {
      handleClick: (view, pos, event) => {
        var _a, _b;
        if (event.button !== 0) {
          return false;
        }
        if (!view.editable) {
          return false;
        }
        let link = null;
        if (event.target instanceof HTMLAnchorElement) {
          link = event.target;
        } else {
          const target = event.target;
          if (!target) {
            return false;
          }
          const root = options.editor.view.dom;
          link = target.closest("a");
          if (link && !root.contains(link)) {
            link = null;
          }
        }
        if (!link) {
          return false;
        }
        let handled = false;
        if (options.enableClickSelection) {
          const commandResult = options.editor.commands.extendMarkRange(options.type.name);
          handled = commandResult;
        }
        if (options.openOnClick) {
          const attrs = (0, import_core2.getAttributes)(view.state, options.type.name);
          const href = (_a = link.href) != null ? _a : attrs.href;
          const target = (_b = link.target) != null ? _b : attrs.target;
          if (href) {
            window.open(href, target);
            handled = true;
          }
        }
        return handled;
      }
    }
  });
}

// src/helpers/pasteHandler.ts
var import_state3 = require("@tiptap/pm/state");
var import_linkifyjs2 = require("linkifyjs");
function pasteHandler(options) {
  return new import_state3.Plugin({
    key: new import_state3.PluginKey("handlePasteLink"),
    props: {
      handlePaste: (view, _event, slice) => {
        const { shouldAutoLink } = options;
        const { state } = view;
        const { selection } = state;
        const { empty } = selection;
        if (empty) {
          return false;
        }
        let textContent = "";
        slice.content.forEach((node) => {
          textContent += node.textContent;
        });
        const link = (0, import_linkifyjs2.find)(textContent, { defaultProtocol: options.defaultProtocol }).find(
          (item) => item.isLink && item.value === textContent
        );
        if (!textContent || !link || shouldAutoLink !== void 0 && !shouldAutoLink(link.value)) {
          return false;
        }
        return options.editor.commands.setMark(options.type, {
          href: link.href
        });
      }
    }
  });
}

// src/link.ts
var pasteRegex = /https?:\/\/(?:www\.)?[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z]{2,}\b(?:[-a-zA-Z0-9@:%._+~#=?!&/]*)(?:[-a-zA-Z0-9@:%._+~#=?!&/]*)/gi;
function isAllowedUri(uri, protocols) {
  const allowedProtocols = [
    "http",
    "https",
    "ftp",
    "ftps",
    "mailto",
    "tel",
    "callto",
    "sms",
    "cid",
    "xmpp"
  ];
  if (protocols) {
    protocols.forEach((protocol) => {
      const nextProtocol = typeof protocol === "string" ? protocol : protocol.scheme;
      if (nextProtocol) {
        allowedProtocols.push(nextProtocol);
      }
    });
  }
  return !uri || uri.replace(UNICODE_WHITESPACE_REGEX_GLOBAL, "").match(
    new RegExp(
      `^(?:(?:${allowedProtocols.map((protocol) => protocol.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")).join("|")}):|[^a-z]|[a-z0-9+.\\-]+(?:[^a-z+.\\-:]|$))`,
      "i"
    )
  );
}
var Link = import_core3.Mark.create({
  name: "link",
  priority: 1e3,
  keepOnSplit: false,
  exitable: true,
  onCreate() {
    if (this.options.validate && !this.options.shouldAutoLink) {
      this.options.shouldAutoLink = this.options.validate;
      console.warn(
        "The `validate` option is deprecated. Rename to the `shouldAutoLink` option instead."
      );
    }
    this.options.protocols.forEach((protocol) => {
      if (typeof protocol === "string") {
        (0, import_linkifyjs3.registerCustomProtocol)(protocol);
        return;
      }
      (0, import_linkifyjs3.registerCustomProtocol)(protocol.scheme, protocol.optionalSlashes);
    });
  },
  onDestroy() {
    (0, import_linkifyjs3.reset)();
  },
  inclusive() {
    return this.options.autolink;
  },
  addOptions() {
    return {
      openOnClick: true,
      enableClickSelection: false,
      linkOnPaste: true,
      autolink: true,
      protocols: [],
      defaultProtocol: "http",
      HTMLAttributes: {
        target: "_blank",
        rel: "noopener noreferrer nofollow",
        class: null
      },
      isAllowedUri: (url, ctx) => !!isAllowedUri(url, ctx.protocols),
      validate: (url) => !!url,
      shouldAutoLink: (url) => {
        const hasProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(url);
        const hasMaybeProtocol = /^[a-z][a-z0-9+.-]*:/i.test(url);
        if (hasProtocol || hasMaybeProtocol && !url.includes("@")) {
          return true;
        }
        const urlWithoutUserinfo = url.includes("@") ? url.split("@").pop() : url;
        const hostname = urlWithoutUserinfo.split(/[/?#:]/)[0];
        if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) {
          return false;
        }
        if (!/\./.test(hostname)) {
          return false;
        }
        return true;
      }
    };
  },
  addAttributes() {
    var _a, _b, _c;
    return {
      href: {
        default: null,
        parseHTML(element) {
          return element.getAttribute("href");
        }
      },
      target: {
        // Coerce `undefined` to `null` because `undefined` is an invalid attribute value
        default: (_a = this.options.HTMLAttributes.target) != null ? _a : null
      },
      rel: {
        // Coerce `undefined` to `null` because `undefined` is an invalid attribute value
        default: (_b = this.options.HTMLAttributes.rel) != null ? _b : null
      },
      class: {
        // Coerce `undefined` to `null` because `undefined` is an invalid attribute value
        default: (_c = this.options.HTMLAttributes.class) != null ? _c : null
      },
      title: {
        default: null
      }
    };
  },
  parseHTML() {
    return [
      {
        tag: "a[href]",
        getAttrs: (dom) => {
          const href = dom.getAttribute("href");
          if (!href || !this.options.isAllowedUri(href, {
            defaultValidate: (url) => !!isAllowedUri(url, this.options.protocols),
            protocols: this.options.protocols,
            defaultProtocol: this.options.defaultProtocol
          })) {
            return false;
          }
          return null;
        }
      }
    ];
  },
  renderHTML({ HTMLAttributes }) {
    if (!this.options.isAllowedUri(HTMLAttributes.href, {
      defaultValidate: (href) => !!isAllowedUri(href, this.options.protocols),
      protocols: this.options.protocols,
      defaultProtocol: this.options.defaultProtocol
    })) {
      return ["a", (0, import_core3.mergeAttributes)(this.options.HTMLAttributes, { ...HTMLAttributes, href: "" }), 0];
    }
    return ["a", (0, import_core3.mergeAttributes)(this.options.HTMLAttributes, HTMLAttributes), 0];
  },
  markdownTokenName: "link",
  parseMarkdown: (token, helpers) => {
    return helpers.applyMark("link", helpers.parseInline(token.tokens || []), {
      href: token.href,
      title: token.title || null
    });
  },
  renderMarkdown: (node, h) => {
    var _a, _b, _c, _d;
    const href = (_b = (_a = node.attrs) == null ? void 0 : _a.href) != null ? _b : "";
    const title = (_d = (_c = node.attrs) == null ? void 0 : _c.title) != null ? _d : "";
    const text = h.renderChildren(node);
    return title ? `[${text}](${href} "${title}")` : `[${text}](${href})`;
  },
  addCommands() {
    return {
      setLink: (attributes) => ({ chain }) => {
        const { href } = attributes;
        if (!this.options.isAllowedUri(href, {
          defaultValidate: (url) => !!isAllowedUri(url, this.options.protocols),
          protocols: this.options.protocols,
          defaultProtocol: this.options.defaultProtocol
        })) {
          return false;
        }
        return chain().setMark(this.name, attributes).setMeta("preventAutolink", true).run();
      },
      toggleLink: (attributes) => ({ chain }) => {
        const { href } = attributes || {};
        if (href && !this.options.isAllowedUri(href, {
          defaultValidate: (url) => !!isAllowedUri(url, this.options.protocols),
          protocols: this.options.protocols,
          defaultProtocol: this.options.defaultProtocol
        })) {
          return false;
        }
        return chain().toggleMark(this.name, attributes, { extendEmptyMarkRange: true }).setMeta("preventAutolink", true).run();
      },
      unsetLink: () => ({ chain }) => {
        return chain().unsetMark(this.name, { extendEmptyMarkRange: true }).setMeta("preventAutolink", true).run();
      }
    };
  },
  addPasteRules() {
    return [
      (0, import_core3.markPasteRule)({
        find: (text) => {
          const foundLinks = [];
          if (text) {
            const { protocols, defaultProtocol } = this.options;
            const links = (0, import_linkifyjs3.find)(text).filter(
              (item) => item.isLink && this.options.isAllowedUri(item.value, {
                defaultValidate: (href) => !!isAllowedUri(href, protocols),
                protocols,
                defaultProtocol
              })
            );
            if (links.length) {
              links.forEach((link) => {
                if (!this.options.shouldAutoLink(link.value)) {
                  return;
                }
                foundLinks.push({
                  text: link.value,
                  data: {
                    href: link.href
                  },
                  index: link.start
                });
              });
            }
          }
          return foundLinks;
        },
        type: this.type,
        getAttributes: (match) => {
          var _a;
          return {
            href: (_a = match.data) == null ? void 0 : _a.href
          };
        }
      })
    ];
  },
  addProseMirrorPlugins() {
    const plugins = [];
    const { protocols, defaultProtocol } = this.options;
    if (this.options.autolink) {
      plugins.push(
        autolink({
          type: this.type,
          defaultProtocol: this.options.defaultProtocol,
          validate: (url) => this.options.isAllowedUri(url, {
            defaultValidate: (href) => !!isAllowedUri(href, protocols),
            protocols,
            defaultProtocol
          }),
          shouldAutoLink: this.options.shouldAutoLink
        })
      );
    }
    plugins.push(
      clickHandler({
        type: this.type,
        editor: this.editor,
        openOnClick: this.options.openOnClick === "whenNotEditable" ? true : this.options.openOnClick,
        enableClickSelection: this.options.enableClickSelection
      })
    );
    if (this.options.linkOnPaste) {
      plugins.push(
        pasteHandler({
          editor: this.editor,
          defaultProtocol: this.options.defaultProtocol,
          type: this.type,
          shouldAutoLink: this.options.shouldAutoLink
        })
      );
    }
    return plugins;
  }
});

// src/index.ts
var index_default = Link;
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  Link,
  isAllowedUri,
  pasteRegex
});
//# sourceMappingURL=index.cjs.map