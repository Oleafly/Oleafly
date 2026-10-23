import { Image } from "@tiptap/extension-image";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { markdownLinkDestination, readableLinkHref } from "../link-destination";

interface ImageSerializerState {
  esc(text: string): string;
  write(text: string): void;
  closeBlock(node: ProseMirrorNode): void;
}

/**
 * Images write their path the way links do: readable, in angle brackets when
 * Markdown needs them. markdown-it percent-encodes every image path it reads,
 * so the stock serializer saved `![](<рис 1.png>)` back as
 * `![](%D1%80%D0%B8%D1%81%201.png)` after any edit in Visual mode.
 *
 * Images are blocks here, and the stock serializer never closed one, so two
 * images on lines of their own, or an image and the paragraph after it, were
 * saved run together on one line.
 */
export const MarkdownImage = Image.extend({
  addStorage() {
    return {
      ...this.parent?.(),
      markdown: {
        serialize(state: ImageSerializerState, node: ProseMirrorNode) {
          const title = node.attrs.title ? ` "${String(node.attrs.title).replaceAll('"', String.raw`\"`)}"` : "";
          const destination = markdownLinkDestination(readableLinkHref(String(node.attrs.src ?? "")));
          state.write(`![${state.esc(String(node.attrs.alt ?? ""))}](${destination}${title})`);
          if (node.isBlock) state.closeBlock(node);
        },
      },
    };
  },
});
