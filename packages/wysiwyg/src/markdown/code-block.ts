import type { Attributes } from "@tiptap/core";
import { CodeBlock } from "@tiptap/extension-code-block";
import type { MarkdownNodeSpec } from "tiptap-markdown";

function fenceFor(code: string, info: string): string {
  // CommonMark lets an info string hold tildes but not backticks.
  const char = info.includes("`") ? "~" : "`";
  let length = 3;
  for (const line of code.split("\n")) {
    const run = /^ {0,3}(`+|~+)/u.exec(line)?.[1];
    if (run?.startsWith(char)) length = Math.max(length, run.length + 1);
  }
  return char.repeat(length);
}

/**
 * Fenced code as a real block, so typing in it can't turn the fence into
 * inline code. `language` holds the whole info string: pandoc attributes like
 * `{.python .numberLines}` are lost if only the first word is kept.
 */
export const MarkdownCodeBlock = CodeBlock.extend({
  addAttributes() {
    const parent: Attributes = this.parent?.() ?? {};
    return {
      ...parent,
      language: {
        ...parent.language,
        parseHTML: (element) =>
          element.getAttribute("data-info") ?? parent.language?.parseHTML?.(element) ?? null,
        rendered: true,
        renderHTML: (attributes) =>
          attributes.language ? { "data-info": attributes.language } : {},
      },
    };
  },

  addKeyboardShortcuts() {
    const parent = this.parent?.() ?? {};
    return {
      ...parent,
      // Tiptap indents through insertContent, which drops text that is only
      // spaces, so Tab did nothing with no selection.
      Tab: (props) => {
        const { $from, empty } = props.editor.state.selection;
        if (!empty || $from.parent.type !== this.type) return parent.Tab?.(props) ?? false;
        const indent = " ".repeat(this.options.tabSize ?? 4);
        return props.editor.commands.command(({ tr }) => {
          tr.insertText(indent);
          return true;
        });
      },
    };
  },

  addStorage() {
    const markdown: MarkdownNodeSpec = {
      serialize(state, node) {
        const info = String(node.attrs.language ?? "");
        const code = node.textContent;
        const fence = fenceFor(code, info);
        state.write(`${fence}${info}\n`);
        // The line break goes through the writer so a blank last line of code
        // stays, and a block inside a quote keeps its prefix.
        if (code) state.text(`${code}\n`, false);
        state.write(fence);
        state.closeBlock(node);
      },
      parse: {
        setup(markdownit) {
          const render = markdownit.renderer.rules.fence;
          if (!render) return;
          markdownit.renderer.rules.fence = (tokens, index, options, env, self) => {
            const html = render(tokens, index, options, env, self);
            const info = tokens[index].info.trim();
            if (!info) return html;
            return html.replace("<pre>", `<pre data-info="${markdownit.utils.escapeHtml(info)}">`);
          };
        },
        updateDOM(element) {
          element.innerHTML = element.innerHTML.replace(/\n<\/code><\/pre>/gu, "</code></pre>");
        },
      },
    };
    return { markdown };
  },
});
