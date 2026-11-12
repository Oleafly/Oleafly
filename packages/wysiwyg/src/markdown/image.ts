import { Image } from "@tiptap/extension-image";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { markdownLinkDestination, readableLinkHref } from "../link-destination";

const ESCAPED_QUOTE = String.raw`\"`;
const WIDTH_DATA = "data-width-percent";
const WIDTH_SUFFIX = /^\{width=(\d{1,3})%\}/u;

export const IMAGE_WIDTH_RANGE = { min: 10, max: 100 } as const;

export function imageWidthPercent(value: unknown): number | null {
  const number = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  if (typeof number !== "number" || !Number.isInteger(number)) return null;
  return number >= IMAGE_WIDTH_RANGE.min && number <= IMAGE_WIDTH_RANGE.max ? number : null;
}

export function imageWidthSuffix(text: string): { width: number; length: number } | null {
  const match = WIDTH_SUFFIX.exec(text);
  const width = imageWidthPercent(match?.[1]);
  return match && width !== null ? { width, length: match[0].length } : null;
}

interface ImageSerializerState {
  esc(text: string): string;
  write(text: string): void;
  closeBlock(node: ProseMirrorNode): void;
}

interface InlineToken {
  type: string;
  content: string;
  attrSet(name: string, value: string): void;
}

interface CoreState {
  tokens: readonly { type: string; children: InlineToken[] | null }[];
}

interface WidthMarkdownIt {
  core: { ruler: { after(name: string, rule: string, run: (state: CoreState) => boolean): void } };
}

const withWidths = new WeakSet<object>();

function readWidths(state: CoreState): boolean {
  for (const block of state.tokens) {
    const children = block.type === "inline" ? block.children : null;
    if (!children) continue;
    for (let index = 0; index + 1 < children.length; index++) {
      const image = children[index];
      const next = children[index + 1];
      if (image.type !== "image" || next.type !== "text") continue;
      const suffix = imageWidthSuffix(next.content);
      if (!suffix) continue;
      image.attrSet(WIDTH_DATA, String(suffix.width));
      next.content = next.content.slice(suffix.length);
    }
  }
  return true;
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
  addAttributes() {
    return {
      ...this.parent?.(),
      widthPercent: {
        default: null,
        parseHTML: (element: HTMLElement) => imageWidthPercent(element.dataset.widthPercent),
        renderHTML: (attributes: Record<string, unknown>) => {
          const width = imageWidthPercent(attributes.widthPercent);
          return width === null ? {} : { [WIDTH_DATA]: String(width), style: `width: ${width}%` };
        },
      },
    };
  },

  addStorage() {
    return {
      ...this.parent?.(),
      markdown: {
        serialize(state: ImageSerializerState, node: ProseMirrorNode) {
          const quoted = String(node.attrs.title ?? "").replaceAll('"', ESCAPED_QUOTE);
          const title = node.attrs.title ? ` "${quoted}"` : "";
          const destination = markdownLinkDestination(readableLinkHref(String(node.attrs.src ?? "")));
          const width = imageWidthPercent(node.attrs.widthPercent);
          const widthSuffix = width === null ? "" : `{width=${width}%}`;
          state.write(`![${state.esc(String(node.attrs.alt ?? ""))}](${destination}${title})${widthSuffix}`);
          if (node.isBlock) state.closeBlock(node);
        },
        parse: {
          setup(markdownit: WidthMarkdownIt) {
            if (withWidths.has(markdownit)) return;
            withWidths.add(markdownit);
            markdownit.core.ruler.after("inline", "image_width", readWidths);
          },
        },
      },
    };
  },
});
