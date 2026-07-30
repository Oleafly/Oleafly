// src/selection/selection.ts
import { Extension, isNodeSelection } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
function shouldSyncDomSelection(state, editor) {
  return !state.selection.empty && !isNodeSelection(state.selection) && editor.isEditable;
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
var Selection = Extension.create({
  name: "selection",
  addOptions() {
    return {
      className: "selection"
    };
  },
  addProseMirrorPlugins() {
    const { editor, options } = this;
    return [
      new Plugin({
        key: new PluginKey("selection"),
        props: {
          decorations(state) {
            if (!shouldPreserveSelection(state, editor)) {
              return null;
            }
            return DecorationSet.create(state.doc, [
              Decoration.inline(state.selection.from, state.selection.to, {
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
export {
  Selection
};
//# sourceMappingURL=index.js.map