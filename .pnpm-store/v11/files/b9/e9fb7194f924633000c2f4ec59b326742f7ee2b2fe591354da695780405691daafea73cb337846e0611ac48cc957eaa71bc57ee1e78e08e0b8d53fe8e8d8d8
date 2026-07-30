// src/text.ts
import { Node } from "@tiptap/core";
var Text = Node.create({
  name: "text",
  group: "inline",
  parseMarkdown: (token) => {
    return {
      type: "text",
      text: token.text || ""
    };
  },
  renderMarkdown: (node) => node.text || ""
});

// src/index.ts
var index_default = Text;
export {
  Text,
  index_default as default
};
//# sourceMappingURL=index.js.map