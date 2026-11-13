import { mergeAttributes, Node, nodeInputRule } from "@tiptap/core";
import { TextSelection, type Transaction } from "@tiptap/pm/state";
import type { MarkdownNodeSpec } from "tiptap-markdown";

export interface HorizontalRuleOptions {
  typedRule: boolean;
}

function selectAfterRule(tr: Transaction): void {
  const { $to } = tr.selection;
  if ($to.nodeAfter?.isTextblock) {
    tr.setSelection(TextSelection.create(tr.doc, $to.pos + 1));
  } else if (!$to.nodeAfter) {
    const paragraph = tr.doc.type.schema.nodes.paragraph.create();
    tr.insert($to.end(), paragraph);
    tr.setSelection(TextSelection.create(tr.doc, $to.end() + 1));
  }
  tr.scrollIntoView();
}

export const MarkdownHorizontalRule = Node.create<HorizontalRuleOptions>({
  name: "horizontalRule",
  group: "block",

  addOptions() {
    return { typedRule: false };
  },

  parseHTML() {
    return [{ tag: "hr" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["hr", mergeAttributes(HTMLAttributes)];
  },

  addStorage() {
    const markdown: MarkdownNodeSpec = {
      serialize(state, node) {
        state.write("---");
        state.closeBlock(node);
      },
    };
    return { markdown };
  },

  addCommands() {
    return {
      setHorizontalRule:
        () =>
        ({ chain }) =>
          chain()
            .insertContent({ type: this.name })
            .command(({ tr, dispatch }) => {
              if (dispatch) selectAfterRule(tr);
              return true;
            })
            .run(),
    };
  },

  addInputRules() {
    if (!this.options.typedRule) return [];
    return [nodeInputRule({ find: /^(?:---|—-|___\s|\*\*\*\s)$/u, type: this.type })];
  },
});
