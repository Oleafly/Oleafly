// src/gap-cursor/gap-cursor.ts
import { callOrReturn, Extension, getExtensionField } from "@tiptap/core";
import { gapCursor } from "@tiptap/pm/gapcursor";
var Gapcursor = Extension.create({
  name: "gapCursor",
  addProseMirrorPlugins() {
    return [gapCursor()];
  },
  extendNodeSchema(extension) {
    var _a;
    const context = {
      name: extension.name,
      options: extension.options,
      storage: extension.storage
    };
    return {
      allowGapCursor: (_a = callOrReturn(getExtensionField(extension, "allowGapCursor", context))) != null ? _a : null
    };
  }
});
export {
  Gapcursor
};
//# sourceMappingURL=index.js.map