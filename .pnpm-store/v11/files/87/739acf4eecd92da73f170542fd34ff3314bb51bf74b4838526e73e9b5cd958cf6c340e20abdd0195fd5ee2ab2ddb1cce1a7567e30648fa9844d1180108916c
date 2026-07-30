// src/drop-cursor/drop-cursor.ts
import { Extension } from "@tiptap/core";
import { dropCursor } from "@tiptap/pm/dropcursor";
var Dropcursor = Extension.create({
  name: "dropCursor",
  addOptions() {
    return {
      color: "currentColor",
      width: 1,
      class: void 0
    };
  },
  addProseMirrorPlugins() {
    return [dropCursor(this.options)];
  }
});
export {
  Dropcursor
};
//# sourceMappingURL=index.js.map