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

// src/gap-cursor/index.ts
var index_exports = {};
__export(index_exports, {
  Gapcursor: () => Gapcursor
});
module.exports = __toCommonJS(index_exports);

// src/gap-cursor/gap-cursor.ts
var import_core = require("@tiptap/core");
var import_gapcursor = require("@tiptap/pm/gapcursor");
var Gapcursor = import_core.Extension.create({
  name: "gapCursor",
  addProseMirrorPlugins() {
    return [(0, import_gapcursor.gapCursor)()];
  },
  extendNodeSchema(extension) {
    var _a;
    const context = {
      name: extension.name,
      options: extension.options,
      storage: extension.storage
    };
    return {
      allowGapCursor: (_a = (0, import_core.callOrReturn)((0, import_core.getExtensionField)(extension, "allowGapCursor", context))) != null ? _a : null
    };
  }
});
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  Gapcursor
});
//# sourceMappingURL=index.cjs.map