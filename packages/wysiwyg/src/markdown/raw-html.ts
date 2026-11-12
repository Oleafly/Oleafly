import { parsingMarkdownSource } from "./engine";

interface HtmlToken {
  type: string;
  content: string;
}

const MODELED_INLINE = /^<\/?(?:a|b|br|code|del|em|i|s|strike|strong|u)(?=[\s/>])/iu;
const TAG_START = /^<[a-z]/iu;
const TABLE_START = /^<table\b/iu;
const EDITOR_ATTRIBUTE = /\sdata-(?:type|text-color|color-box)\b/iu;
const SCRIPT_TAG = /^<\/?(sup|sub)>$/u;

function tagName(html: string): string | null {
  return /^<\/?([a-z][\w-]*)/iu.exec(html)?.[1].toLowerCase() ?? null;
}

function writtenByEditor(html: string): boolean {
  if (!TAG_START.test(html)) return false;
  const close = html.indexOf(">");
  return EDITOR_ATTRIBUTE.test(close === -1 ? html : html.slice(0, close));
}

function partnerOf(tokens: readonly HtmlToken[], index: number): string | null {
  const name = tagName(tokens[index].content);
  const closing = tokens[index].content.startsWith("</");
  const step = closing ? -1 : 1;
  let depth = 0;
  for (let cursor = index + step; cursor >= 0 && cursor < tokens.length; cursor += step) {
    const token = tokens[cursor];
    if (token.type !== "html_inline" || tagName(token.content) !== name) continue;
    if (token.content.startsWith("</") === closing) depth++;
    else if (depth-- === 0) return token.content;
  }
  return null;
}

function plainScriptPair(tokens: readonly HtmlToken[], index: number): boolean {
  if (!SCRIPT_TAG.test(tokens[index].content)) return false;
  const partner = partnerOf(tokens, index);
  return partner !== null && SCRIPT_TAG.test(partner);
}

export function keepsInlineHtml(tokens: readonly HtmlToken[], index: number): boolean {
  if (!parsingMarkdownSource()) return true;
  const source = tokens[index].content;
  if (MODELED_INLINE.test(source) || plainScriptPair(tokens, index)) return true;
  const opener = source.startsWith("</") ? partnerOf(tokens, index) : source;
  return opener !== null && writtenByEditor(opener);
}

export function keepsBlockHtml(source: string): boolean {
  if (!parsingMarkdownSource()) return true;
  const html = source.replace(/^[ \t]+/u, "");
  return TABLE_START.test(html) || writtenByEditor(html);
}
