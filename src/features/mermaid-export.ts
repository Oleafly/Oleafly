const SVG_NS = "http://www.w3.org/2000/svg";
const PREFERRED_SCALE = 2;
const TARGET_RASTER_SIDE = 2000;
const MAX_RASTER_SIDE = 8192;
const MAX_RASTER_PIXELS = 4096 * 4096;
const LINE_HEIGHT_EM = 1.1;
const WRAP_SLACK = 0.5;
const BLOCK_ELEMENTS = new Set(["div", "p", "li", "ul", "ol", "tr", "table", "h1", "h2", "h3", "h4", "h5", "h6"]);
const INLINE_TAGS = new Set([
  "a",
  "abbr",
  "b",
  "big",
  "cite",
  "code",
  "del",
  "dfn",
  "em",
  "font",
  "i",
  "img",
  "ins",
  "kbd",
  "mark",
  "q",
  "s",
  "samp",
  "small",
  "span",
  "strike",
  "strong",
  "sub",
  "sup",
  "tt",
  "u",
  "var",
]);
const TAG = /^<(\/?)([a-z]+)(?:\s[^<>]*)?>$/i;
const EM_OFFSET = /^(-?(?:\d+(?:\.\d+)?|\.\d+))em$/;
const ENTITY = /&(?:#\d+|#x[\da-f]+|[a-z][a-z\d]*);/i;
const LOOSE_AMPERSAND = /&(?!#\d+;|#x[\da-f]+;|[a-z][a-z\d]*;)/gi;
const SOURCE_GAP = String.raw`((?:\s|\*|_|<br\s*/?>|\\n)*)`;
const CLOSING_PUNCTUATION = /^[.,;:!?)\]}%]/;
const OPENING_PUNCTUATION = /[([{]$/;
const OPEN_TAG_FRAGMENT = /<[^<>]*$/;
const OPEN_ENTITY_FRAGMENT = /&#?[a-z\d]*$/i;
const ENTITY_TAIL = /^#?[a-z\d]*;/i;

type RunStyle = {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  shift: "sub" | "super" | null;
  fill: string | null;
};
type Run = { text: string; style: RunStyle };
type Line = Run[];
type Word = { content: string; line: number; weight: string | null; fontStyle: string | null };
type PlainStyle = { className: string | null; weight: string | null; fontStyle: string | null };

const PLAIN_RUN: RunStyle = { bold: false, italic: false, underline: false, strike: false, shift: null, fill: null };
const TAG_STYLES: Record<string, Partial<RunStyle>> = {
  b: { bold: true },
  strong: { bold: true },
  i: { italic: true },
  em: { italic: true },
  cite: { italic: true },
  dfn: { italic: true },
  var: { italic: true },
  u: { underline: true },
  ins: { underline: true },
  s: { strike: true },
  strike: { strike: true },
  del: { strike: true },
  sub: { shift: "sub" },
  sup: { shift: "super" },
};

export const MERMAID_EXPORT_DIRECTIVE =
  '%%{init: {"htmlLabels": false, "flowchart": {"htmlLabels": false}}}%%';

export type StandaloneMermaidSvg = { svg: string; width: number; height: number };

export function mermaidExportSource(source: string): string {
  return `${source.trimEnd()}${MERMAID_EXPORT_DIRECTIVE}`;
}

function numberAttribute(element: Element, name: string): number {
  const value = Number.parseFloat(element.getAttribute(name) ?? "");
  return Number.isFinite(value) ? value : 0;
}

function rounded(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function naturalSize(svg: Element): { width: number; height: number } {
  const box = (svg.getAttribute("viewBox") ?? "").trim().split(/[\s,]+/).map(Number);
  if (box.length === 4 && box.every(Number.isFinite) && box[2] > 0 && box[3] > 0) {
    return { width: box[2], height: box[3] };
  }
  const absolute = (name: string) => {
    const value = svg.getAttribute(name) ?? "";
    return /%/.test(value) ? 0 : numberAttribute(svg, name);
  };
  return { width: absolute("width"), height: absolute("height") };
}

function styleColor(element: Element): string | null {
  const match = /(?:^|;)\s*color\s*:\s*([^;]+)/i.exec(element.getAttribute("style") ?? "");
  if (match) return match[1].replace(/!important/i, "").trim();
  return element.localName.toLowerCase() === "font" ? element.getAttribute("color") : null;
}

function styledRun(element: Element, parent: RunStyle): RunStyle {
  const fill = styleColor(element);
  return { ...parent, ...TAG_STYLES[element.localName.toLowerCase()], ...(fill ? { fill } : {}) };
}

function sameStyle(a: RunStyle, b: RunStyle): boolean {
  return (Object.keys(a) as (keyof RunStyle)[]).every((key) => a[key] === b[key]);
}

function normalizedLine(line: Line): Line {
  const runs: Run[] = [];
  for (const run of line) {
    const previous = runs.at(-1);
    let text = run.text.replace(/[ \t\n\r\f]+/g, " ");
    if (!previous || previous.text.endsWith(" ")) text = text.replace(/^ /, "");
    if (!text) continue;
    if (previous && sameStyle(previous.style, run.style)) previous.text += text;
    else runs.push({ text, style: run.style });
  }
  let last = runs.at(-1);
  while (last) {
    last.text = last.text.replace(/ $/, "");
    if (last.text) break;
    runs.pop();
    last = runs.at(-1);
  }
  return runs;
}

function htmlLines(root: Node): Line[] {
  let line: Line = [];
  const lines: Line[] = [line];
  const newLine = () => {
    line = [];
    lines.push(line);
  };
  const breakLine = () => {
    if (line.some((run) => /[^ \t\n\r\f]/.test(run.text))) newLine();
  };
  const visit = (current: Node, style: RunStyle) => {
    for (const child of Array.from(current.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        line.push({ text: child.textContent ?? "", style });
        continue;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) continue;
      const element = child as Element;
      const name = element.localName.toLowerCase();
      if (name === "br") {
        newLine();
        continue;
      }
      if (name === "style" || name === "script") continue;
      const block = BLOCK_ELEMENTS.has(name);
      if (block) breakLine();
      visit(element, styledRun(element, style));
      if (block) breakLine();
    }
  };
  visit(root, PLAIN_RUN);
  return lines.map(normalizedLine).filter((line) => line.length > 0);
}

function runTspan(owner: Document, run: Run, plain: PlainStyle): Element {
  const tspan = owner.createElementNS(SVG_NS, "tspan");
  const weight = run.style.bold ? "bold" : plain.weight;
  const fontStyle = run.style.italic ? "italic" : plain.fontStyle;
  if (plain.className) tspan.setAttribute("class", plain.className);
  if (fontStyle !== null) tspan.setAttribute("font-style", fontStyle);
  if (weight !== null) tspan.setAttribute("font-weight", weight);
  const decoration = [run.style.underline ? "underline" : "", run.style.strike ? "line-through" : ""]
    .filter(Boolean)
    .join(" ");
  if (decoration) tspan.setAttribute("text-decoration", decoration);
  if (run.style.shift) {
    tspan.setAttribute("baseline-shift", run.style.shift);
    tspan.setAttribute("font-size", "75%");
  }
  if (run.style.fill) tspan.setAttribute("style", `fill: ${run.style.fill}`);
  tspan.textContent = run.text;
  return tspan;
}

function inlineTag(content: string): { closing: boolean; name: string } | null {
  const match = TAG.exec(content);
  const name = match?.[2].toLowerCase();
  return match && name && INLINE_TAGS.has(name) ? { closing: match[1] === "/", name } : null;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}

function sourcePattern(content: string): string {
  if (inlineTag(content)) return escapeRegExp(content).replace(/['"]/g, `['"]`);
  return content
    .split(/(&#\d+;|&[a-z][a-z\d]*;|[&<>'"])/i)
    .map((part) => {
      const numeric = /^&#(\d+);$/.exec(part);
      if (numeric) return `(?:&#|#)${numeric[1]};`;
      const named = /^&([a-z][a-z\d]*);$/i.exec(part);
      if (named) return `[&#]${named[1]};`;
      if (part === "&") return "(?:&amp;|&)";
      if (part === "<") return "(?:&lt;|<)";
      if (part === ">") return "(?:&gt;|>)";
      if (part === "'") return "(?:&#39;|')";
      if (part === '"') return '(?:[&#]quot;|")';
      return escapeRegExp(part);
    })
    .join("");
}

function sourceGaps(words: Word[], source: string): boolean[] | null {
  if (!source) return null;
  const match = new RegExp(words.map((word) => sourcePattern(word.content)).join(SOURCE_GAP)).exec(source);
  return match ? match.slice(1).map((gap) => !/\s|<br|\\n/i.test(gap)) : null;
}

function guessedGaps(words: Word[]): boolean[] {
  return words.slice(1).map((word, index) => {
    const previous = inlineTag(words[index].content);
    const next = inlineTag(word.content);
    if (next?.closing || (previous && !previous.closing)) return true;
    if (next && (next.name === "sub" || next.name === "sup")) return true;
    if (next && OPENING_PUNCTUATION.test(words[index].content)) return true;
    return Boolean(previous?.closing && CLOSING_PUNCTUATION.test(word.content));
  });
}

function escapedWord(word: Word): string {
  const text = word.content.replaceAll("<", "&lt;").replaceAll(">", "&gt;").replace(LOOSE_AMPERSAND, "&amp;");
  const italic = word.fontStyle === "italic" ? `<i>${text}</i>` : text;
  return word.weight === "bold" ? `<b>${italic}</b>` : italic;
}

function wordsHtml(words: Word[], joined: boolean[]): string {
  return words
    .map((word, index) => {
      const content = inlineTag(word.content) ? word.content : escapedWord(word);
      if (index === 0 || joined[index - 1]) return content;
      return `${word.line === words[index - 1].line ? " " : "<br>"}${content}`;
    })
    .join("");
}

function outerTspans(text: Element): Element[] {
  return Array.from(text.children).filter(
    (child) => child.localName === "tspan" && child.classList.contains("text-outer-tspan"),
  );
}

function splitsToken(head: string, tail: string): boolean {
  if (OPEN_TAG_FRAGMENT.test(head) && tail.includes(">")) return true;
  return OPEN_ENTITY_FRAGMENT.test(head) && ENTITY_TAIL.test(tail);
}

function joinWrappedFragments(words: Word[]): Word[] {
  const joined: Word[] = [];
  for (const word of words) {
    const previous = joined.at(-1);
    if (previous && previous.line !== word.line && splitsToken(previous.content, word.content)) {
      joined[joined.length - 1] = { ...previous, content: previous.content + word.content };
    } else {
      joined.push(word);
    }
  }
  return joined;
}

function formattedWords(outers: Element[]): Word[] {
  const words = outers.flatMap((outer, line) =>
    Array.from(outer.children).flatMap((inner, index) => {
      const raw = inner.textContent ?? "";
      const content = index > 0 && raw.startsWith(" ") ? raw.slice(1) : raw;
      if (!content) return [];
      return [{ content, line, weight: inner.getAttribute("font-weight"), fontStyle: inner.getAttribute("font-style") }];
    }),
  );
  return joinWrappedFragments(words);
}

function plainStyle(words: Word[], outers: Element[]): PlainStyle {
  return {
    className: outers.find((outer) => outer.firstElementChild)?.firstElementChild?.getAttribute("class") ?? null,
    weight: words.find((word) => word.weight !== "bold")?.weight ?? "normal",
    fontStyle: words.find((word) => word.fontStyle !== "italic")?.fontStyle ?? "normal",
  };
}

function shiftLine(outer: Element, offset: number) {
  const match = EM_OFFSET.exec(outer.getAttribute("y") ?? "");
  if (match && offset) outer.setAttribute("y", `${rounded(Number(match[1]) + offset)}em`);
}

function needsRewrite(words: Word[]): boolean {
  return words.some((word) => inlineTag(word.content) || ENTITY.test(word.content));
}

function rewriteFormattedText(text: Element, outers: Element[], words: Word[], source: string) {
  const joined = sourceGaps(words, source) ?? guessedGaps(words);
  const html = new DOMParser().parseFromString(`<!doctype html><body>${wordsHtml(words, joined)}`, "text/html");
  const lines = htmlLines(html.body);
  const plain = plainStyle(words, outers);
  const offset = ((outers.length - lines.length) * LINE_HEIGHT_EM) / 2;
  for (const [index, outer] of outers.entries()) {
    const line = lines[index];
    if (!line) {
      outer.remove();
      continue;
    }
    outer.replaceChildren(...line.map((run) => runTspan(text.ownerDocument, run, plain)));
    shiftLine(outer, offset);
  }
}

function soleLabelOfShape(text: Element): boolean {
  const shape = text.closest(".node, .cluster");
  return shape !== null && shape.getElementsByTagNameNS(SVG_NS, "text").length === 1;
}

function startAnchored(text: Element): boolean {
  return getComputedStyle(text).getPropertyValue("text-anchor") === "start";
}

function recenter(text: SVGGraphicsElement, before: DOMRect) {
  const after = text.getBBox();
  const dx = rounded(before.x + before.width / 2 - (after.x + after.width / 2));
  if (Math.abs(dx) < 0.01) return;
  const shift = `translate(${dx}, 0)`;
  const transform = text.getAttribute("transform");
  text.setAttribute("transform", transform ? `${shift} ${transform}` : shift);
}

function rewriteFormattedLabels(svg: Element, source: string, measurable: boolean) {
  for (const text of Array.from(svg.getElementsByTagNameNS(SVG_NS, "text"))) {
    const outers = outerTspans(text);
    const words = formattedWords(outers);
    if (!needsRewrite(words)) continue;
    const graphic = text as SVGGraphicsElement;
    const before = measurable && soleLabelOfShape(text) && startAnchored(text) ? graphic.getBBox() : null;
    rewriteFormattedText(text, outers, words, source);
    if (before) recenter(graphic, before);
  }
}

function inlineColor(node: Element): string | null {
  let color: string | null = null;
  for (const element of Array.from(node.querySelectorAll("[style]"))) {
    color = styleColor(element) ?? color;
  }
  return color;
}

function firstTextElement(node: Element): Element | null {
  const walker = node.ownerDocument.createTreeWalker(node, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    if (walker.currentNode.textContent?.trim()) return walker.currentNode.parentElement;
  }
  return null;
}

function lineWords(line: Line): Line[] {
  const words: Line[] = [];
  let word: Run[] = [];
  for (const run of line) {
    for (const piece of run.text.split(/(?= )/)) {
      if (piece.startsWith(" ") && word.length > 0) {
        words.push(word);
        word = [];
      }
      word.push({ text: piece, style: run.style });
    }
  }
  if (word.length > 0) words.push(word);
  return words;
}

function withoutLeadingSpace(word: Line): Line {
  return word.map((run, index) => (index === 0 ? { ...run, text: run.text.replace(/^ /, "") } : run));
}

function wrappedRows(text: SVGTextContentElement, lines: Line[], width: number): Line[] {
  const plain: PlainStyle = { className: null, weight: null, fontStyle: null };
  const measure = (row: Line) => {
    text.replaceChildren(...row.map((run) => runTspan(text.ownerDocument, run, plain)));
    return text.getComputedTextLength();
  };
  const rows: Line[] = [];
  for (const line of lines) {
    let row: Line = [];
    for (const word of lineWords(line)) {
      const candidate = row.length > 0 ? [...row, ...word] : withoutLeadingSpace(word);
      if (row.length > 0 && measure(candidate) > width + WRAP_SLACK) {
        rows.push(row);
        row = withoutLeadingSpace(word);
      } else {
        row = candidate;
      }
    }
    if (row.length > 0) rows.push(row);
  }
  text.replaceChildren();
  return rows;
}

function replaceForeignObject(node: Element, measurable: boolean) {
  const parent = node.parentElement;
  const target = parent?.localName === "switch" ? parent : node;
  const lines = htmlLines(node);
  if (lines.length === 0) {
    target.remove();
    return;
  }
  const x = numberAttribute(node, "x");
  const y = numberAttribute(node, "y");
  const width = numberAttribute(node, "width");
  const height = numberAttribute(node, "height");
  const owner = node.ownerDocument;
  const labelElement = measurable ? firstTextElement(node) : null;
  const computed = labelElement ? getComputedStyle(labelElement) : null;
  const color = computed?.color || inlineColor(node);
  const wraps = measurable && width > 0 && computed?.whiteSpace !== "nowrap";
  const text = owner.createElementNS(SVG_NS, "text") as SVGTextElement;
  text.setAttribute("text-anchor", "middle");
  text.setAttribute("dominant-baseline", "central");
  if (color) text.setAttribute("style", `fill: ${color}`);
  target.replaceWith(text);
  const rows = wraps ? wrappedRows(text, lines, width) : lines;
  const fontSize = measurable ? Number.parseFloat(getComputedStyle(text).fontSize) : 0;
  const lineHeight = Math.max(height > 0 ? height / rows.length : 0, fontSize > 0 ? fontSize * 1.2 : 0) || 16;
  const plain: PlainStyle = { className: null, weight: null, fontStyle: null };
  for (const [index, row] of rows.entries()) {
    const tspan = owner.createElementNS(SVG_NS, "tspan");
    tspan.setAttribute("x", String(rounded(x + width / 2)));
    tspan.setAttribute("y", String(rounded(y + height / 2 + (index - (rows.length - 1) / 2) * lineHeight)));
    tspan.append(...row.map((run) => runTspan(owner, run, plain)));
    text.append(tspan);
  }
}

function centerMindmapLabels(svg: Element) {
  for (const label of Array.from(svg.querySelectorAll(".mindmap-node > .label"))) {
    if (!/^translate\(\s*0\s*[,\s]/.test(label.getAttribute("transform") ?? "")) continue;
    for (const text of Array.from(label.querySelectorAll("text"))) {
      if (!text.hasAttribute("text-anchor")) text.setAttribute("text-anchor", "middle");
    }
  }
}

function withoutMaxWidth(style: string): string {
  return style
    .split(";")
    .map((declaration) => declaration.trim())
    .filter((declaration) => declaration && !/^max-width\s*:/i.test(declaration))
    .join("; ");
}

function withMountedSvg(svg: Element, work: (measurable: boolean) => void) {
  const body = svg.ownerDocument.body;
  if (!body) {
    work(false);
    return;
  }
  const host = svg.ownerDocument.createElement("div");
  host.setAttribute("aria-hidden", "true");
  host.style.cssText =
    "all: initial; position: fixed; left: -100000px; top: 0; visibility: hidden; pointer-events: none;";
  host.append(svg);
  body.append(host);
  try {
    work(typeof (svg as Partial<SVGGraphicsElement>).getBBox === "function");
  } finally {
    host.remove();
  }
}

export function standaloneMermaidSvg(diagram: Element, source = ""): StandaloneMermaidSvg {
  const svg = document.importNode(diagram, true);
  withMountedSvg(svg, (measurable) => {
    centerMindmapLabels(svg);
    rewriteFormattedLabels(svg, source, measurable);
    for (const node of Array.from(svg.getElementsByTagNameNS(SVG_NS, "foreignObject"))) {
      replaceForeignObject(node, measurable);
    }
  });
  const { width, height } = naturalSize(svg);
  if (width > 0 && height > 0) {
    svg.setAttribute("width", String(width));
    svg.setAttribute("height", String(height));
    const inline = withoutMaxWidth(svg.getAttribute("style") ?? "");
    if (inline) svg.setAttribute("style", inline);
    else svg.removeAttribute("style");
  }
  return { svg: new XMLSerializer().serializeToString(svg), width, height };
}

export function mermaidRasterScale(width: number, height: number): number {
  if (!(width > 0 && height > 0)) return PREFERRED_SCALE;
  const longest = Math.max(width, height);
  return Math.min(
    Math.max(PREFERRED_SCALE, TARGET_RASTER_SIDE / longest),
    MAX_RASTER_SIDE / longest,
    Math.sqrt(MAX_RASTER_PIXELS / (width * height)),
  );
}
