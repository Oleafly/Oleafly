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

// src/undo-redo/index.ts
var index_exports = {};
__export(index_exports, {
  UndoRedo: () => UndoRedo
});
module.exports = __toCommonJS(index_exports);

// src/undo-redo/undo-redo.ts
var import_core = require("@tiptap/core");
var import_history = require("@tiptap/pm/history");
var UndoRedo = import_core.Extension.create({
  name: "undoRedo",
  addOptions() {
    return {
      depth: 100,
      newGroupDelay: 500
    };
  },
  addCommands() {
    return {
      undo: () => ({ state, dispatch }) => {
        return (0, import_history.undo)(state, dispatch);
      },
      redo: () => ({ state, dispatch }) => {
        return (0, import_history.redo)(state, dispatch);
      }
    };
  },
  addProseMirrorPlugins() {
    return [(0, import_history.history)(this.options)];
  },
  addKeyboardShortcuts() {
    return {
      "Mod-z": () => this.editor.commands.undo(),
      "Shift-Mod-z": () => this.editor.commands.redo(),
      "Mod-y": () => this.editor.commands.redo(),
      // Russian keyboard layouts
      "Mod-\u044F": () => this.editor.commands.undo(),
      "Shift-Mod-\u044F": () => this.editor.commands.redo()
    };
  }
});
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  UndoRedo
});
//# sourceMappingURL=index.cjs.map