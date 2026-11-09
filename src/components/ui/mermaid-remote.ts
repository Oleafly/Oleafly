import { i18n } from "@/i18n";
import { remoteImageHost } from "@/lib/remote-image";

export class MermaidRemoteContentError extends Error {
  constructor() {
    super(i18n.t(($) => $.core.mermaid.remoteBlocked));
    this.name = "MermaidRemoteContentError";
  }
}

export function isMermaidRemoteContentError(error: unknown): boolean {
  return error instanceof MermaidRemoteContentError;
}

export const MERMAID_SECURE_KEYS: string[] = [
  "secure",
  "securityLevel",
  "startOnLoad",
  "maxTextSize",
  "suppressErrorRendering",
  "maxEdges",
  "dompurifyConfig",
];

export const MERMAID_LABEL_PURIFY = {
  FORBID_TAGS: ["style"],
  FORBID_ATTR: [
    "src",
    "srcset",
    "imagesrcset",
    "href",
    "xlink:href",
    "poster",
    "background",
    "lowsrc",
    "dynsrc",
    "data",
    "action",
    "formaction",
    "ping",
  ],
};

const DECODE_PASSES = 4;
const VALUE_WINDOW = 2048;
const STRING_ESCAPES: Readonly<Record<string, string>> = {
  "0": "\0",
  a: "\x07",
  b: "\b",
  t: "\t",
  n: "\n",
  v: "\v",
  f: "\f",
  r: "\r",
  e: "\x1b",
  N: "\x85",
  _: "\xa0",
  L: "\u2028",
  P: "\u2029",
};
const STRING_ESCAPE = /\\(?:\r?\n[ \t]*|x([0-9a-fA-F]{2})|u\{([0-9a-fA-F]{1,6})\}|U([0-9a-fA-F]{8})|u([0-9a-fA-F]{4})|([\s\S]))/g;
const CSS_ESCAPE = /\\(?:([0-9a-fA-F]{1,6})(?:\r\n|[ \t\n\r\f])?|(\r\n|[\n\r\f])|([^\n\r\f0-9a-fA-F]))/g;
const MERMAID_ENTITY = /(?<!&)#(\w+);/g;
const NUMERIC_ENTITY = /&#(?:[xX]([0-9a-fA-F]+)|(\d+));?/g;
const CSS_URL = /\b(?:url|src)\(/g;
const RESOURCE_ATTRIBUTE = /(?:^|[\s"'/])(srcset|imagesrcset|src|poster|background|lowsrc|dynsrc)\s*=\s*/g;
const RESOURCE_HREF = /<(?:image|use|feimage|link|base)\b[^<]*?[\s"'/](?:xlink:)?href\s*=\s*/g;
const IMAGE_KEY = /(?:^|[^\w$-])["']?(?:img|icon)["']?\s*:/g;
const SEQUENCE_DIAGRAM = /^[ \t]*sequencediagram\b/m;
const SEQUENCE_DETAILS = /^[ \t]*details[ \t]+[^\s:][^\n:]*:/m;
const URL_ATTRIBUTES = new Set(["href", "src", "poster", "background", "lowsrc", "dynsrc", "data", "action", "formaction"]);
const URL_LIST_ATTRIBUTES = new Set(["srcset", "imagesrcset", "ping"]);

let entityArea: HTMLTextAreaElement | null = null;

function codePoint(value: number): string {
  const valid = Number.isInteger(value) && value > 0 && value <= 0x10ffff && (value < 0xd800 || value > 0xdfff);
  return valid ? String.fromCodePoint(value) : "\ufffd";
}

function decodeStringEscapes(text: string): string {
  if (!text.includes("\\")) return text;
  return text.replace(STRING_ESCAPE, (_whole, hex: string | undefined, braced: string | undefined, long: string | undefined, short: string | undefined, single: string | undefined) => {
    const digits = hex ?? braced ?? long ?? short;
    if (digits !== undefined) return codePoint(Number.parseInt(digits, 16));
    if (single !== undefined) return STRING_ESCAPES[single] ?? single;
    return "";
  });
}

function decodeCssEscapes(text: string): string {
  if (!text.includes("\\")) return text;
  return text.replace(CSS_ESCAPE, (_whole, hex: string | undefined, _newline: string | undefined, single: string | undefined) => {
    if (hex !== undefined) return codePoint(Number.parseInt(hex, 16));
    return single ?? "";
  });
}

function decodeHtmlEntities(text: string): string {
  if (!text.includes("&")) return text;
  if (typeof DOMParser === "function") {
    entityArea ??= new DOMParser().parseFromString("", "text/html").createElement("textarea");
    entityArea.innerHTML = text;
    return entityArea.value;
  }
  return text.replace(NUMERIC_ENTITY, (_whole, hex: string | undefined, decimal: string | undefined) =>
    codePoint(hex === undefined ? Number.parseInt(decimal ?? "", 10) : Number.parseInt(hex, 16)),
  );
}

function decodeEntities(text: string): string {
  const html = text.includes("#")
    ? text.replace(MERMAID_ENTITY, (_whole, name: string) => (/^\d+$/.test(name) ? `&#${name};` : `&${name};`))
    : text;
  return decodeHtmlEntities(html);
}

function decodedVariants(source: string): string[] {
  let strings = source;
  let markup = source;
  for (let pass = 0; pass < DECODE_PASSES; pass++) {
    const nextStrings = decodeCssEscapes(decodeEntities(decodeStringEscapes(strings)));
    const nextMarkup = decodeCssEscapes(decodeEntities(markup));
    if (nextStrings === strings && nextMarkup === markup) break;
    strings = nextStrings;
    markup = nextMarkup;
  }
  const variants = new Set([source.toLowerCase(), strings.toLowerCase(), markup.toLowerCase()]);
  return [...variants];
}

function isRemote(target: string): boolean {
  const value = target.trim();
  return value.startsWith("var(") || remoteImageHost(value) !== null;
}

function quotedOr(text: string, start: number, stop: RegExp): string {
  const rest = text.slice(start, start + VALUE_WINDOW).replace(/^\s+/, "");
  const quote = rest.charAt(0);
  if (quote === '"' || quote === "'") {
    const end = rest.indexOf(quote, 1);
    return rest.slice(1, end === -1 ? undefined : end);
  }
  const end = rest.search(stop);
  return end === -1 ? rest : rest.slice(0, end);
}

function cssTargets(text: string): string[] {
  if (!text.includes("(")) return [];
  return [...text.matchAll(CSS_URL)].map((match) => quotedOr(text, match.index + match[0].length, /\)/));
}

function attributeTargets(text: string): string[] {
  if (!text.includes("=")) return [];
  const targets: string[] = [];
  for (const match of text.matchAll(RESOURCE_ATTRIBUTE)) {
    const value = quotedOr(text, match.index + match[0].length, /[\s>]/);
    const list = match[1] === "srcset" || match[1] === "imagesrcset";
    targets.push(...(list ? value.split(",").map((candidate) => candidate.trim().split(/\s+/)[0] ?? "") : [value]));
  }
  for (const match of text.matchAll(RESOURCE_HREF)) {
    targets.push(quotedOr(text, match.index + match[0].length, /[\s>]/));
  }
  return targets;
}

function dataValue(text: string, start: number): string | null {
  let rest = text.slice(start, start + VALUE_WINDOW).replace(/^\s+/, "");
  while (/^[&!]/.test(rest)) rest = rest.replace(/^[&!]\S*\s*/, "");
  const first = rest.charAt(0);
  if (first === "") return "";
  if (first === '"' || first === "'") {
    const end = rest.indexOf(first, 1);
    return rest.slice(1, end === -1 ? undefined : end);
  }
  if ("*|>[{".includes(first)) return null;
  return /^[^,}\]\n]*/.exec(rest)?.[0] ?? "";
}

function dataLoadsRemote(text: string): boolean {
  if (!text.includes(":")) return false;
  for (const match of text.matchAll(IMAGE_KEY)) {
    const value = dataValue(text, match.index + match[0].length);
    if (value === null || isRemote(value)) return true;
  }
  return false;
}

function textLoadsRemote(text: string): boolean {
  if (text.includes("image-set(") || text.includes("@import")) return true;
  if (cssTargets(text).some(isRemote)) return true;
  if (attributeTargets(text).some(isRemote)) return true;
  if (dataLoadsRemote(text)) return true;
  return SEQUENCE_DIAGRAM.test(text) && SEQUENCE_DETAILS.test(text);
}

export function sourceLoadsRemoteContent(source: string): boolean {
  return decodedVariants(source).some(textLoadsRemote);
}

function cssLoadsRemote(css: string): boolean {
  const text = decodeCssEscapes(css).toLowerCase();
  if (text.includes("image-set(") || text.includes("@import")) return true;
  return cssTargets(text).some(isRemote);
}

function attributeLoadsRemote(attribute: Attr): boolean {
  const name = attribute.localName.toLowerCase();
  if (URL_LIST_ATTRIBUTES.has(name)) return attribute.value.split(/[\s,]+/).some((token) => token !== "" && isRemote(token));
  if (URL_ATTRIBUTES.has(name)) return isRemote(attribute.value);
  return cssLoadsRemote(attribute.value);
}

function unlink(anchor: Element): void {
  for (const attribute of [...anchor.attributes]) {
    const name = attribute.localName.toLowerCase();
    const inPage = name === "href" && attribute.value.trim().startsWith("#");
    if ((name === "href" && !inPage) || name === "ping" || name === "target") anchor.removeAttributeNode(attribute);
  }
}

export function secureDrawing(svg: Element): void {
  for (const element of [svg, ...svg.querySelectorAll("*")]) {
    if (element.localName.toLowerCase() === "a") unlink(element);
    for (const attribute of [...element.attributes]) {
      if (attributeLoadsRemote(attribute)) throw new MermaidRemoteContentError();
    }
    if (element.localName.toLowerCase() === "style" && cssLoadsRemote(element.textContent ?? "")) {
      throw new MermaidRemoteContentError();
    }
  }
}
