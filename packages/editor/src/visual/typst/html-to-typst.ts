export interface HtmlToTypstOptions {
  hasFiles?: boolean;
}

const SKIPPED = new Set(["script", "style", "template", "noscript", "head", "meta", "link", "title", "img", "svg"]);
const BLOCKS = new Set([
  "p",
  "div",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "ul",
  "ol",
  "li",
  "blockquote",
  "pre",
  "table",
  "hr",
  "figure",
  "figcaption",
  "section",
  "article",
  "main",
  "header",
  "footer",
  "aside",
  "nav",
  "dl",
  "address",
]);
const ESCAPED = new Set(["\\", "*", "_", "`", "$", "#", "<", "@", "[", "]", "~"]);
const WORD = /[\p{L}\p{N}_]/u;
const LINE_MARKER = /^(?:[=+/-]|\d+\.)(?=\s|$)/u;
const LINE_BREAK = " \\\n";
const INDENT = "  ";

function tagOf(node: Node): string {
  return node.nodeType === Node.ELEMENT_NODE ? (node as Element).tagName.toLowerCase() : "";
}

function isElement(node: Node): node is Element {
  return node.nodeType === Node.ELEMENT_NODE;
}

function containsBlock(element: Element): boolean {
  return Array.from(element.children).some((child) => BLOCKS.has(tagOf(child)) || containsBlock(child));
}

function escapeText(text: string): string {
  let result = "";
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (ESCAPED.has(character) || (character === "/" && text[index + 1] === "/")) result += `\\${character}`;
    else result += character;
  }
  return result;
}

function escapeString(text: string): string {
  return text.replaceAll("\\", "\\\\").replaceAll('"', String.raw`\"`).replaceAll("\n", String.raw`\n`);
}

function escapeLineStarts(text: string): string {
  return text
    .split("\n")
    .map((line) => {
      const marker = LINE_MARKER.exec(line);
      if (!marker) return line;
      const value = marker[0];
      return /^\d/u.test(value) ? String.raw`${value.slice(0, -1)}\.${line.slice(value.length)}` : `\\${line}`;
    })
    .join("\n");
}

function tidy(text: string): string {
  return text
    .split("\n")
    .map((line) => line.replaceAll(/[ \t]+/gu, " ").trim())
    .join("\n")
    .trim()
    .replace(/ \\$/u, "");
}

function styleOf(element: Element): string {
  return (element.getAttribute("style") ?? "").toLowerCase().replaceAll(/\s+/gu, "");
}

function boldStyle(style: string): boolean | null {
  const weight = /font-weight:([a-z0-9]+)/u.exec(style)?.[1];
  if (!weight) return null;
  if (weight === "bold" || weight === "bolder") return true;
  const number = Number.parseInt(weight, 10);
  return Number.isFinite(number) ? number >= 600 : false;
}

function neighbourText(node: Node | null, step: (node: Node) => Node | null): string {
  let current = node;
  while (current && SKIPPED.has(tagOf(current))) current = step(current);
  return current?.textContent ?? "";
}

function neighbourIsWord(element: Element): boolean {
  const before = neighbourText(element.previousSibling, (node) => node.previousSibling);
  const after = neighbourText(element.nextSibling, (node) => node.nextSibling);
  return WORD.test(before.slice(-1)) || WORD.test(after.slice(0, 1));
}

function wrap(element: Element, content: string, marker: string, call: string): string {
  const inner = content.trim();
  if (inner === "") return content;
  const lead = /^\s*/u.exec(content)?.[0] ?? "";
  const trail = content.slice(content.trimEnd().length);
  const form = neighbourIsWord(element) || inner.includes("\n") ? `#${call}[${inner}]` : `${marker}${inner}${marker}`;
  return `${lead}${form}${trail}`;
}

function call(name: string, content: string): string {
  const inner = content.trim();
  return inner === "" ? content : `#${name}[${inner}]`;
}

function rawInline(text: string): string {
  if (text === "") return "";
  if (!text.includes("`") && !text.includes("\n")) return `\`${text}\``;
  return `#raw("${escapeString(text)}")`;
}

function link(element: Element, content: string): string {
  const href = element.getAttribute("href")?.trim() ?? "";
  if (href === "" || href.startsWith("#") || /^javascript:/iu.test(href)) return content;
  const text = (element.textContent ?? "").trim();
  if (text === href && /^https?:\/\/\S+$/u.test(href)) return href;
  const inner = content.trim();
  return inner === "" ? `#link("${escapeString(href)}")` : `#link("${escapeString(href)}")[${inner}]`;
}

function spanStyles(element: Element, content: string): string {
  const style = styleOf(element);
  let result = content;
  if (style.includes("text-decoration:underline") || style.includes("text-decoration-line:underline")) {
    result = call("underline", result);
  }
  if (style.includes("line-through")) result = call("strike", result);
  if (style.includes("font-style:italic")) result = wrap(element, result, "_", "emph");
  if (boldStyle(style)) result = wrap(element, result, "*", "strong");
  return result;
}

function renderElementInline(element: Element): string {
  const tag = tagOf(element);
  if (SKIPPED.has(tag)) return "";
  if (tag === "br") return LINE_BREAK;
  if (tag === "code" || tag === "kbd" || tag === "samp" || tag === "tt") return rawInline(element.textContent ?? "");
  const content = renderInline(Array.from(element.childNodes));
  switch (tag) {
    case "b":
    case "strong":
      return boldStyle(styleOf(element)) === false ? content : wrap(element, content, "*", "strong");
    case "i":
    case "em":
    case "cite":
    case "dfn":
    case "var":
      return wrap(element, content, "_", "emph");
    case "u":
    case "ins":
      return call("underline", content);
    case "s":
    case "strike":
    case "del":
      return call("strike", content);
    case "mark":
      return call("highlight", content);
    case "sup":
      return call("super", content);
    case "sub":
      return call("sub", content);
    case "a":
      return link(element, content);
    case "span":
    case "font":
      return spanStyles(element, content);
    default:
      return content;
  }
}

function renderInline(nodes: readonly Node[]): string {
  let result = "";
  for (const node of nodes) {
    if (node.nodeType === Node.TEXT_NODE) result += escapeText((node.textContent ?? "").replaceAll(/\s+/gu, " "));
    else if (isElement(node)) result += BLOCKS.has(tagOf(node)) ? ` ${renderInline(Array.from(node.childNodes))} ` : renderElementInline(node);
  }
  return result;
}

function paragraph(nodes: readonly Node[]): string {
  return escapeLineStarts(tidy(renderInline(nodes)));
}

function longestRun(text: string, character: string): number {
  let longest = 0;
  let current = 0;
  for (const value of text) {
    current = value === character ? current + 1 : 0;
    longest = Math.max(longest, current);
  }
  return longest;
}

function renderPre(element: Element): string {
  const text = (element.textContent ?? "").replace(/\n$/u, "");
  const source = element.querySelector("code") ?? element;
  const language = /(?:^|\s)language-([\w+-]+)/u.exec(source.getAttribute("class") ?? "")?.[1] ?? "";
  const fence = "`".repeat(Math.max(3, longestRun(text, "`") + 1));
  return `${fence}${language}\n${text}\n${fence}`;
}

function renderList(list: Element, depth: number): string {
  const marker = tagOf(list) === "ol" ? "+" : "-";
  const indent = INDENT.repeat(depth);
  const lines: string[] = [];
  for (const item of Array.from(list.children)) {
    if (tagOf(item) !== "li") continue;
    const inline: Node[] = [];
    const nested: string[] = [];
    for (const child of Array.from(item.childNodes)) {
      const tag = tagOf(child);
      if (tag === "ul" || tag === "ol") nested.push(renderList(child as Element, depth + 1));
      else inline.push(child);
    }
    const text = tidy(renderInline(inline)).replaceAll("\n", `\n${indent}${INDENT}`);
    lines.push(`${indent}${marker} ${text}`.trimEnd(), ...nested);
  }
  return lines.join("\n");
}

function cellContent(cell: Element): string {
  return tidy(renderInline(Array.from(cell.childNodes))).replaceAll(LINE_BREAK, String.raw` \ `).replaceAll("\n", " ");
}

function renderTable(table: Element): string {
  const rows = Array.from(table.querySelectorAll("tr")).filter((row) => row.closest("table") === table);
  const grid = rows.map((row) => Array.from(row.children).filter((cell) => ["td", "th"].includes(tagOf(cell))));
  const width = Math.max(
    1,
    ...grid.map((cells) => cells.reduce((sum, cell) => sum + Math.max(1, Number(cell.getAttribute("colspan") ?? 1) || 1), 0)),
  );
  const render = (cells: Element[]) => {
    let used = 0;
    const parts = cells.map((cell) => {
      const span = Math.max(1, Number(cell.getAttribute("colspan") ?? 1) || 1);
      used += span;
      const content = `[${cellContent(cell)}]`;
      return span > 1 ? `table.cell(colspan: ${span})${content}` : content;
    });
    while (used < width) {
      parts.push("[]");
      used += 1;
    }
    return parts.join(", ");
  };
  const lines = ["#table(", `${INDENT}columns: ${width},`];
  const [first, ...rest] = grid;
  const header = first && first.length > 0 && first.every((cell) => tagOf(cell) === "th");
  if (header) lines.push(`${INDENT}table.header(${render(first)}),`);
  for (const cells of header ? rest : grid) {
    if (cells.length > 0) lines.push(`${INDENT}${render(cells)},`);
  }
  lines.push(")");
  return lines.join("\n");
}

function renderTerms(list: Element): string {
  const lines: string[] = [];
  let term = "";
  for (const child of Array.from(list.children)) {
    const tag = tagOf(child);
    if (tag === "dt") term = tidy(renderInline(Array.from(child.childNodes)));
    else if (tag === "dd") {
      lines.push(`/ ${term}: ${tidy(renderInline(Array.from(child.childNodes)))}`);
      term = "";
    }
  }
  return lines.join("\n");
}

function renderBlock(element: Element): string[] {
  const tag = tagOf(element);
  const heading = /^h([1-6])$/u.exec(tag);
  if (heading) {
    const text = tidy(renderInline(Array.from(element.childNodes))).replaceAll(LINE_BREAK, " ").replaceAll("\n", " ");
    return text === "" ? [] : [`${"=".repeat(Number(heading[1]))} ${text}`];
  }
  switch (tag) {
    case "ul":
    case "ol":
      return [renderList(element, 0)];
    case "dl":
      return [renderTerms(element)];
    case "pre":
      return [renderPre(element)];
    case "table":
      return [renderTable(element)];
    case "hr":
      return ["#line(length: 100%)"];
    case "blockquote": {
      const inner = renderBlocks(element).join("\n\n");
      return inner === "" ? [] : [`#quote(block: true)[${inner}]`];
    }
    default:
      return renderBlocks(element);
  }
}

function renderBlocks(container: Node): string[] {
  const blocks: string[] = [];
  let inline: Node[] = [];
  const flush = () => {
    const text = paragraph(inline);
    if (text !== "") blocks.push(text);
    inline = [];
  };
  for (const child of Array.from(container.childNodes)) {
    const tag = tagOf(child);
    if (SKIPPED.has(tag)) continue;
    if (isElement(child) && (BLOCKS.has(tag) || containsBlock(child))) {
      flush();
      blocks.push(...(BLOCKS.has(tag) ? renderBlock(child) : renderBlocks(child)));
    } else {
      inline.push(child);
    }
  }
  flush();
  return blocks.filter((block) => block.trim() !== "");
}

function loneElement(body: HTMLElement): Element | null {
  const meaningful = Array.from(body.childNodes).filter((node) => {
    if (node.nodeType === Node.TEXT_NODE) return (node.textContent ?? "").trim() !== "";
    return isElement(node) && !SKIPPED.has(tagOf(node));
  });
  const [only] = meaningful;
  if (meaningful.length !== 1 || !isElement(only)) return null;
  return BLOCKS.has(tagOf(only)) ? only : (loneElement(only as HTMLElement) ?? only);
}

export function htmlToTypst(html: string, options: HtmlToTypstOptions = {}): string | null {
  if (typeof DOMParser === "undefined" || html.trim() === "") return null;
  const parsed = new DOMParser().parseFromString(html, "text/html");
  const lone = loneElement(parsed.body);
  const loneTag = lone ? tagOf(lone) : null;
  if (options.hasFiles && loneTag !== "table") return null;
  if (loneTag === "pre") return null;
  const text = renderBlocks(parsed.body).join("\n\n").trim();
  return text === "" ? null : text;
}
