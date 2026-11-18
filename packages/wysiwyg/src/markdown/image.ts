import { Image, type ImageOptions } from "@tiptap/extension-image";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { NodeViewRenderer } from "@tiptap/core";
import { isUrlWithScheme, markdownLinkDestination, readableLinkHref } from "../link-destination";
import { rawInlineMarkup } from "../raw-inline";
import type { AssetUrlResolver } from "../options";
import { parsingMarkdownSource } from "./engine";
import { ATTRIBUTE_BLOCK } from "./pandoc-inline";

const ESCAPED_QUOTE = String.raw`\"`;
const WIDTH_DATA = "data-width-percent";
const ATTRIBUTES_DATA = "data-pandoc-attributes";
const WIDTH_SUFFIX = /^\{width=(\d{1,3})%\}/u;
const WIDTH_IN_BLOCK = /(^\{|\s)width=(\d{1,3})%(?=[\s}])/u;

interface MarkdownImageOptions extends ImageOptions {
  resolveAssetUrl: AssetUrlResolver | null;
}

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

/**
 * A Pandoc attribute block after a figure, such as `{#fig-loss}` or
 * `{#fig:x .wide width=50%}`, stays whole on the image and is written back as
 * it was. A width inside it shows on the image and follows its width control;
 * a width the editor can't use keeps the image as source instead.
 */
function imageAttributes(text: string): { block: string; width: number | null } | null {
  if (imageWidthSuffix(text)) return null;
  const block = ATTRIBUTE_BLOCK.exec(text)?.[0];
  if (!block) return null;
  const written = WIDTH_IN_BLOCK.exec(block)?.[2];
  const width = written === undefined ? null : imageWidthPercent(written);
  if (written !== undefined && width === null) return null;
  return { block, width };
}

export function withImageWidth(block: string, width: number | null): string {
  if (WIDTH_IN_BLOCK.test(block)) {
    if (width !== null) return block.replace(WIDTH_IN_BLOCK, (_all, lead: string) => `${lead}width=${width}%`);
    return block.replace(WIDTH_IN_BLOCK, (_all, lead: string) => (lead === "{" ? "{" : "")).replace(/^\{\s+/u, "{");
  }
  if (width === null) return block;
  const inner = block.slice(1, -1).trim();
  return inner ? `{${inner} width=${width}%}` : `{width=${width}%}`;
}

function suffixLength(text: string): number {
  return imageWidthSuffix(text)?.length ?? imageAttributes(text)?.block.length ?? 0;
}

interface ImageSerializerState {
  esc(text: string): string;
  write(text: string): void;
  closeBlock(node: ProseMirrorNode): void;
}

interface InlineToken {
  type: string;
  content: string;
  meta: { source?: string } | null;
  children: InlineToken[] | null;
  attrSet(name: string, value: string): void;
}

interface BlockToken {
  type: string;
  hidden: boolean;
  children: InlineToken[] | null;
  attrGet(name: string): string | null;
}

interface CoreState {
  tokens: readonly BlockToken[];
}

interface InlineState {
  pos: number;
  src: string;
  tokens: InlineToken[];
}

type InlineRule = (state: InlineState, silent: boolean) => boolean;

interface WidthMarkdownIt {
  core: { ruler: { after(name: string, rule: string, run: (state: CoreState) => boolean): void } };
  inline: { ruler: { __rules__: { name: string; fn: InlineRule }[]; at(name: string, rule: InlineRule): void } };
  renderer: { rules: Record<string, (tokens: InlineToken[], index: number) => string> };
  utils: { escapeHtml(text: string): string };
}

const withWidths = new WeakSet<object>();
const WHITESPACE = /^\s*$/u;

function keepImageSources(markdownit: WidthMarkdownIt): void {
  const image = markdownit.inline.ruler.__rules__.find((rule) => rule.name === "image")?.fn;
  if (!image) return;
  markdownit.inline.ruler.at("image", (state, silent) => {
    const start = state.pos;
    if (!image(state, silent)) return false;
    const token = silent ? undefined : state.tokens.at(-1);
    if (token?.type === "image") token.meta = { ...token.meta, source: state.src.slice(start, state.pos) };
    return true;
  });
  markdownit.renderer.rules.image_source = (tokens, index) => rawInlineMarkup(tokens[index].content, markdownit.utils.escapeHtml);
}

function standsAlone(children: readonly InlineToken[]): boolean {
  let images = 0;
  for (const [index, child] of children.entries()) {
    if (child.type === "image") images++;
    else if (child.type !== "text") return false;
    else if (!WHITESPACE.test(children[index - 1]?.type === "image" ? child.content.slice(suffixLength(child.content)) : child.content)) return false;
  }
  return images === 1;
}

function imagesAsSource(state: CoreState): boolean {
  if (!parsingMarkdownSource()) return true;
  state.tokens.forEach((block, index) => {
    const children = block.type === "inline" ? block.children : null;
    if (!children?.some((child) => child.type === "image")) return;
    const opener = state.tokens[index - 1];
    if (opener?.type === "paragraph_open" && !opener.hidden && opener.attrGet("data-text-align") === null && standsAlone(children)) return;
    rawImages(children);
  });
  return true;
}

function rawImages(children: InlineToken[]): void {
  for (const [index, child] of children.entries()) {
    if (child.children) rawImages(child.children);
    const source = child.type === "image" ? child.meta?.source : undefined;
    if (source === undefined) continue;
    const next = children[index + 1];
    const attributes = next?.type === "text" ? (ATTRIBUTE_BLOCK.exec(next.content)?.[0] ?? "") : "";
    if (attributes) next.content = next.content.slice(attributes.length);
    child.type = "image_source";
    child.content = source + attributes;
    child.children = null;
  }
}

function readWidths(state: CoreState): boolean {
  for (const block of state.tokens) {
    const children = block.type === "inline" ? block.children : null;
    if (!children) continue;
    for (let index = 0; index + 1 < children.length; index++) {
      const image = children[index];
      const next = children[index + 1];
      if (image.type !== "image" || next.type !== "text") continue;
      const suffix = imageWidthSuffix(next.content);
      if (suffix) {
        image.attrSet(WIDTH_DATA, String(suffix.width));
        next.content = next.content.slice(suffix.length);
        continue;
      }
      const attributes = imageAttributes(next.content);
      if (!attributes) continue;
      image.attrSet(ATTRIBUTES_DATA, attributes.block);
      if (attributes.width !== null) image.attrSet(WIDTH_DATA, String(attributes.width));
      next.content = next.content.slice(attributes.block.length);
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
function imageNodeView(resolveAssetUrl: AssetUrlResolver): NodeViewRenderer {
  return ({ node: initialNode }) => {
    let node = initialNode;
    let generation = 0;
    let destroyed = false;
    const image = document.createElement("img");

    const updateImage = () => {
      const request = ++generation;
      const source = String(node.attrs.src ?? "");
      image.alt = String(node.attrs.alt ?? "");
      if (node.attrs.title) image.title = String(node.attrs.title);
      else image.removeAttribute("title");
      const width = imageWidthPercent(node.attrs.widthPercent);
      image.style.width = width === null ? "" : `${width}%`;

      if (source === "" || isUrlWithScheme(source)) {
        if (source) image.setAttribute("src", source);
        else image.removeAttribute("src");
        return;
      }

      image.removeAttribute("src");
      void resolveAssetUrl(readableLinkHref(source)).then((url) => {
        if (destroyed || request !== generation) return;
        if (url) image.setAttribute("src", url);
      }, () => undefined);
    };

    updateImage();
    return {
      dom: image,
      update(nextNode) {
        if (nextNode.type !== node.type) return false;
        node = nextNode;
        updateImage();
        return true;
      },
      ignoreMutation: () => true,
      destroy() {
        destroyed = true;
      },
    };
  };
}

export const MarkdownImage = Image.extend<MarkdownImageOptions>({
  addOptions() {
    return {
      ...this.parent?.(),
      inline: this.parent?.().inline ?? false,
      allowBase64: this.parent?.().allowBase64 ?? false,
      HTMLAttributes: this.parent?.().HTMLAttributes ?? {},
      resize: this.parent?.().resize ?? false,
      resolveAssetUrl: null,
    };
  },

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
      pandocAttributes: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute(ATTRIBUTES_DATA) || null,
        renderHTML: (attributes: Record<string, unknown>) =>
          typeof attributes.pandocAttributes === "string" ? { [ATTRIBUTES_DATA]: attributes.pandocAttributes } : {},
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
          const attributes = typeof node.attrs.pandocAttributes === "string" ? node.attrs.pandocAttributes : null;
          const widthSuffix = attributes ? withImageWidth(attributes, width) : width === null ? "" : `{width=${width}%}`;
          state.write(`![${state.esc(String(node.attrs.alt ?? ""))}](${destination}${title})${widthSuffix}`);
          if (node.isBlock) state.closeBlock(node);
        },
        parse: {
          setup(markdownit: WidthMarkdownIt) {
            if (withWidths.has(markdownit)) return;
            withWidths.add(markdownit);
            keepImageSources(markdownit);
            markdownit.core.ruler.after("inline", "image_width", readWidths);
            markdownit.core.ruler.after("inline", "image_source", imagesAsSource);
          },
        },
      },
    };
  },

  addNodeView() {
    return this.options.resolveAssetUrl ? imageNodeView(this.options.resolveAssetUrl) : null;
  },
});
