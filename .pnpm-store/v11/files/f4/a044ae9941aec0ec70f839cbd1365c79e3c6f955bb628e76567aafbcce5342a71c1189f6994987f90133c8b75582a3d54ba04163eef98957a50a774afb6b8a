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

// src/trailing-node/index.ts
var index_exports = {};
__export(index_exports, {
  TrailingNode: () => TrailingNode,
  skipTrailingNodeMeta: () => skipTrailingNodeMeta
});
module.exports = __toCommonJS(index_exports);

// src/trailing-node/trailing-node.ts
var import_core = require("@tiptap/core");
var import_state = require("@tiptap/pm/state");
var skipTrailingNodeMeta = "skipTrailingNode";
function nodeEqualsType({
  types,
  node
}) {
  return node && Array.isArray(types) && types.includes(node.type) || (node == null ? void 0 : node.type) === types;
}
var TrailingNode = import_core.Extension.create({
  name: "trailingNode",
  addOptions() {
    return {
      node: void 0,
      notAfter: []
    };
  },
  addProseMirrorPlugins() {
    var _a;
    const plugin = new import_state.PluginKey(this.name);
    const defaultNode = this.options.node || ((_a = this.editor.schema.topNodeType.contentMatch.defaultType) == null ? void 0 : _a.name) || "paragraph";
    const disabledNodes = Object.entries(this.editor.schema.nodes).map(([, value]) => value).filter((node) => (this.options.notAfter || []).concat(defaultNode).includes(node.name));
    return [
      new import_state.Plugin({
        key: plugin,
        appendTransaction: (transactions, __, state) => {
          const { doc, tr, schema } = state;
          const shouldInsertNodeAtEnd = plugin.getState(state);
          const endPosition = doc.content.size;
          const type = schema.nodes[defaultNode];
          if (transactions.some((transaction) => transaction.getMeta(skipTrailingNodeMeta))) {
            return;
          }
          if (!shouldInsertNodeAtEnd) {
            return;
          }
          return tr.insert(endPosition, type.create());
        },
        state: {
          init: (_, state) => {
            const lastNode = state.tr.doc.lastChild;
            return !nodeEqualsType({ node: lastNode, types: disabledNodes });
          },
          apply: (tr, value) => {
            if (!tr.docChanged) {
              return value;
            }
            if (tr.getMeta("__uniqueIDTransaction")) {
              return value;
            }
            const lastNode = tr.doc.lastChild;
            return !nodeEqualsType({ node: lastNode, types: disabledNodes });
          }
        }
      })
    ];
  }
});
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  TrailingNode,
  skipTrailingNodeMeta
});
//# sourceMappingURL=index.cjs.map