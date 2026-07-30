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

// src/selection/index.ts
var index_exports = {};
__export(index_exports, {
  Selection: () => Selection
});
module.exports = __toCommonJS(index_exports);

// src/selection/selection.ts
var import_core = require("@tiptap/core");
var import_state = require("@tiptap/pm/state");
var import_view = require("@tiptap/pm/view");
function shouldSyncDomSelection(state, editor) {
  return !state.selection.empty && !(0, import_core.isNodeSelection)(state.selection) && editor.isEditable;
}
function shouldPreserveSelection(state, editor) {
  return shouldSyncDomSelection(state, editor) && !editor.isFocused && !editor.view.dragging;
}
function clearDomSelection() {
  var _a;
  (_a = window.getSelection()) == null ? void 0 : _a.removeAllRanges();
}
function restoreDomSelection(view) {
  view.focus();
}
var Selection = import_core.Extension.create({
  name: "selection",
  addOptions() {
    return {
      className: "selection"
    };
  },
  addProseMirrorPlugins() {
    const { editor, options } = this;
    return [
      new import_state.Plugin({
        key: new import_state.PluginKey("selection"),
        props: {
          decorations(state) {
            if (!shouldPreserveSelection(state, editor)) {
              return null;
            }
            return import_view.DecorationSet.create(state.doc, [
              import_view.Decoration.inline(state.selection.from, state.selection.to, {
                class: options.className
              })
            ]);
          },
          handleDOMEvents: {
            blur(view) {
              if (!shouldSyncDomSelection(view.state, editor)) {
                return false;
              }
              clearDomSelection();
              return false;
            },
            focus(view) {
              if (!shouldSyncDomSelection(view.state, editor)) {
                return false;
              }
              requestAnimationFrame(() => {
                if (!editor.isDestroyed && view.hasFocus()) {
                  restoreDomSelection(view);
                }
              });
              return false;
            }
          }
        }
      })
    ];
  }
});
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  Selection
});
//# sourceMappingURL=index.cjs.map