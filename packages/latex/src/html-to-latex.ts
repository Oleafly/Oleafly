import DOMPurify from "dompurify";

export function escapeLatexText(text: string): string {
  return text.replace(/([\\{}&%$#_^~])/g, (ch) => {
    if (ch === "\\") return String.raw`\textbackslash{}`;
    if (ch === "^") return String.raw`\textasciicircum{}`;
    if (ch === "~") return String.raw`\textasciitilde{}`;
    return `\\${ch}`;
  });
}

export interface HtmlToLatexOptions {
  hasFiles?: boolean;
}

interface Context {
  inTable: boolean;
}

interface GridCell {
  element: Element;
  colspan: number;
  rowspan: number;
  rowOffset: number;
  colOffset: number;
}

const PARAGRAPH_BREAK = "\0";
const NO_BREAK_SPACE = "\u00A0";
const INDENT = "    ";
const SECTIONING = ["section", "subsection", "subsubsection", "paragraph", "subparagraph"];
const VERB_DELIMITERS = ["|", "!", "+", "=", "#", "@"];
const VISIBLE_BORDER = /\b(?:solid|double|dashed|dotted|groove|ridge|inset|outset)\b/u;
const BLOCK_TAGS = new Set([
  "address",
  "article",
  "aside",
  "blockquote",
  "dd",
  "div",
  "dl",
  "dt",
  "fieldset",
  "figcaption",
  "figure",
  "footer",
  "form",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hr",
  "li",
  "main",
  "nav",
  "ol",
  "p",
  "pre",
  "section",
  "table",
  "ul",
]);
const WRAPPER_TAGS = new Set([
  "article",
  "body",
  "center",
  "div",
  "font",
  "google-sheets-html-origin",
  "html",
  "main",
  "section",
  "span",
]);
const IGNORED_TAGS = new Set(["link", "meta", "script", "style", "title"]);

function isElement(node: Node): node is Element {
  return node.nodeType === 1;
}

function tagOf(element: Element): string {
  return element.tagName.toLowerCase();
}

function isBlock(node: Node): node is Element {
  return isElement(node) && BLOCK_TAGS.has(tagOf(node));
}

function containsBlock(element: Element): boolean {
  return Array.from(element.querySelectorAll("*")).some((child) => BLOCK_TAGS.has(tagOf(child)));
}

function styleProperty(element: Element, name: string): string | null {
  const style = element.getAttribute("style") ?? "";
  const match = new RegExp(String.raw`(?:^|;)\s*${name}\s*:\s*([^;]*)`, "iu").exec(style);
  return match ? match[1].trim().toLowerCase() : null;
}

function meaningfulChildren(node: Node): Node[] {
  return Array.from(node.childNodes).filter((child) => {
    if (isElement(child)) return !IGNORED_TAGS.has(tagOf(child));
    return child.nodeType === 3 && (child.textContent ?? "").trim() !== "";
  });
}

function loneElement(body: Element): Element | null {
  let current = body;
  for (;;) {
    const children = meaningfulChildren(current);
    const child = children.length === 1 ? children[0] : null;
    if (!child || !isElement(child)) return current === body ? null : current;
    if (!WRAPPER_TAGS.has(tagOf(child))) return child;
    current = child;
  }
}

function isOfficeDocument(html: string): boolean {
  return /name=["']?ProgId["' ]/iu.test(html) || /urn:schemas-microsoft-com:office/iu.test(html);
}

function normalizeSpace(text: string): string {
  return text.replace(/\s+/gu, " ").trim();
}

function paragraphsFrom(text: string): string[] {
  return text
    .split(PARAGRAPH_BREAK)
    .map(normalizeSpace)
    .filter((paragraph) => paragraph !== "");
}

const URL_ESCAPES: Readonly<Record<string, string>> = {
  "\\": String.raw`\%5C`,
  "%": String.raw`\%`,
  "#": String.raw`\#`,
  "&": String.raw`\&`,
  _: String.raw`\_`,
  "{": String.raw`\{`,
  "}": String.raw`\}`,
};

function escapeUrl(url: string): string {
  return url.replace(/[\\%#&_{}]/gu, (ch) => URL_ESCAPES[ch] ?? ch);
}

function inlineCode(element: Element): string {
  const text = element.textContent ?? "";
  if (/[\r\n]/u.test(text)) return String.raw`\texttt{${escapeLatexText(normalizeSpace(text))}}`;
  const delimiter = VERB_DELIMITERS.find((candidate) => !text.includes(candidate));
  return delimiter
    ? String.raw`\verb${delimiter}${text}${delimiter}`
    : String.raw`\texttt{${escapeLatexText(text)}}`;
}

interface InlineFlags {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  superscript: boolean;
  subscript: boolean;
}

function inlineFlags(element: Element, tag: string): InlineFlags {
  const weight = styleProperty(element, "font-weight");
  const fontStyle = styleProperty(element, "font-style");
  const decoration =
    styleProperty(element, "text-decoration") ?? styleProperty(element, "text-decoration-line");
  const vertical = styleProperty(element, "vertical-align");
  return {
    bold:
      tag === "b" ||
      tag === "strong" ||
      weight === "bold" ||
      weight === "bolder" ||
      Number(weight) >= 700,
    italic: tag === "i" || tag === "em" || fontStyle === "italic" || fontStyle === "oblique",
    underline: tag === "u" || (decoration?.includes("underline") ?? false),
    superscript: tag === "sup" || vertical === "super",
    subscript: tag === "sub" || vertical === "sub",
  };
}

function wrapFlags(core: string, flags: InlineFlags): string {
  let wrapped = core;
  if (flags.superscript) wrapped = String.raw`\textsuperscript{${wrapped}}`;
  if (flags.subscript) wrapped = String.raw`\textsubscript{${wrapped}}`;
  if (flags.underline) wrapped = String.raw`\underline{${wrapped}}`;
  if (flags.italic) wrapped = String.raw`\textit{${wrapped}}`;
  if (flags.bold) wrapped = String.raw`\textbf{${wrapped}}`;
  return wrapped;
}

function wrapInline(element: Element, tag: string, inner: string): string {
  const core = inner.trim();
  if (core === "") return inner;
  const leading = inner.slice(0, inner.length - inner.trimStart().length);
  const trailing = inner.slice(inner.trimEnd().length);
  let wrapped = wrapFlags(core, inlineFlags(element, tag));
  const href = tag === "a" ? element.getAttribute("href") : null;
  if (href) wrapped = String.raw`\href{${escapeUrl(href)}}{${wrapped}}`;
  return `${leading}${wrapped}${trailing}`;
}

function renderChildrenInline(element: Element, context: Context): string {
  return Array.from(element.childNodes)
    .map((child) => renderInline(child, context))
    .join("");
}

function renderInline(node: Node, context: Context): string {
  if (node.nodeType === 3) {
    return escapeLatexText((node.textContent ?? "").replaceAll(NO_BREAK_SPACE, " "));
  }
  if (!isElement(node)) return "";
  const tag = tagOf(node);
  if (IGNORED_TAGS.has(tag) || tag === "img") return "";
  if (tag === "br") return context.inTable ? " " : PARAGRAPH_BREAK;
  if (tag === "code") return inlineCode(node);
  if (isBlock(node)) return renderChildrenInline(node, context);
  return wrapInline(node, tag, renderChildrenInline(node, context));
}

function renderNodes(nodes: Node[], context: Context): string[] {
  const out: string[] = [];
  let inline = "";
  const flush = () => {
    out.push(...paragraphsFrom(inline));
    inline = "";
  };
  for (const node of nodes) {
    if (isBlock(node) || (isElement(node) && containsBlock(node))) {
      flush();
      out.push(...renderBlockNode(node, context).filter((block) => block !== ""));
      continue;
    }
    inline += renderInline(node, context);
  }
  flush();
  return out;
}

function renderBlocks(container: Node, context: Context): string[] {
  return renderNodes(Array.from(container.childNodes), context);
}

function renderHeading(element: Element, level: number, context: Context): string {
  const text = normalizeSpace(
    renderChildrenInline(element, context).replaceAll(PARAGRAPH_BREAK, " "),
  );
  if (context.inTable) return text;
  return `\\${SECTIONING[Math.min(level, SECTIONING.length) - 1]}{${text}}`;
}

function renderQuote(element: Element, context: Context): string {
  const inner = renderBlocks(element, context).join("\n\n");
  return inner ? `\\begin{quote}\n${inner}\n\\end{quote}` : "";
}

function renderPre(element: Element, context: Context): string[] {
  const family = styleProperty(element, "font-family");
  const monospace = family === null || /mono|courier|consolas|menlo|monaco|code/u.test(family);
  if (!monospace && !element.querySelector("code")) return renderBlocks(element, context);
  const text = (element.textContent ?? "").replace(/^\n/u, "").trimEnd();
  return [`\\begin{verbatim}\n${text}\n\\end{verbatim}`];
}

function listItems(list: Element): Element[] {
  return Array.from(list.children).filter((child) => tagOf(child) === "li");
}

function renderListItem(item: Element, context: Context, depth: number): string[] {
  const nested: string[] = [];
  const lead: Node[] = [];
  for (const child of Array.from(item.childNodes)) {
    if (isElement(child) && (tagOf(child) === "ul" || tagOf(child) === "ol")) {
      nested.push(renderList(child, context, depth));
    } else {
      lead.push(child);
    }
  }
  const text = renderNodes(lead, context).join(" ");
  const suffix = text ? ` ${text}` : "";
  return [String.raw`${INDENT.repeat(depth)}\item${suffix}`, ...nested];
}

function renderList(list: Element, context: Context, depth: number): string {
  if (context.inTable) {
    return listItems(list)
      .map((item) => renderBlocks(item, context).join(" "))
      .filter((text) => text !== "")
      .join("; ");
  }
  const environment = tagOf(list) === "ol" ? "enumerate" : "itemize";
  const indent = INDENT.repeat(depth);
  const lines = [String.raw`${indent}\begin{${environment}}`];
  for (const child of Array.from(list.children)) {
    const tag = tagOf(child);
    if (tag === "li") lines.push(...renderListItem(child, context, depth + 1));
    else if (tag === "ul" || tag === "ol") lines.push(renderList(child, context, depth + 1));
  }
  lines.push(String.raw`${indent}\end{${environment}}`);
  return lines.join("\n");
}

function renderBlockNode(element: Element, context: Context): string[] {
  const tag = tagOf(element);
  const heading = /^h([1-6])$/u.exec(tag);
  if (heading) return [renderHeading(element, Number(heading[1]), context)];
  if (tag === "ul" || tag === "ol") return [renderList(element, context, 0)];
  if (tag === "blockquote") return [renderQuote(element, context)];
  if (tag === "pre") return renderPre(element, context);
  if (tag === "table") return [renderTable(element, context)];
  if (tag === "hr") return [];
  return renderBlocks(element, context);
}

function clampSpan(value: string | null, limit: number): number {
  const parsed = Number.parseInt(value ?? "1", 10);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, limit) : 1;
}

function tableRowElements(table: Element): Element[] {
  const rows: Element[] = [];
  for (const child of Array.from(table.children)) {
    const tag = tagOf(child);
    if (tag === "tr") rows.push(child);
    else if (tag === "thead" || tag === "tbody" || tag === "tfoot") {
      rows.push(...Array.from(child.children).filter((row) => tagOf(row) === "tr"));
    }
  }
  return rows;
}

function placeCell(grid: GridCell[][], rowIndex: number, column: number, cell: Element): number {
  const colspan = clampSpan(cell.getAttribute("colspan"), 100);
  const rowspan = clampSpan(cell.getAttribute("rowspan"), grid.length - rowIndex);
  for (let rowOffset = 0; rowOffset < rowspan; rowOffset++) {
    for (let colOffset = 0; colOffset < colspan; colOffset++) {
      grid[rowIndex + rowOffset][column + colOffset] = {
        element: cell,
        colspan,
        rowspan,
        rowOffset,
        colOffset,
      };
    }
  }
  return colspan;
}

function layoutGrid(rows: Element[]): GridCell[][] {
  const grid: GridCell[][] = rows.map(() => []);
  rows.forEach((row, rowIndex) => {
    let column = 0;
    const cells = Array.from(row.children).filter(
      (cell) => tagOf(cell) === "td" || tagOf(cell) === "th",
    );
    for (const cell of cells) {
      while (grid[rowIndex][column]) column++;
      column += placeCell(grid, rowIndex, column, cell);
    }
  });
  return grid;
}

function cellAlignment(element: Element): "l" | "c" | "r" {
  const align =
    styleProperty(element, "text-align") ?? element.getAttribute("align")?.toLowerCase() ?? "";
  if (align === "center") return "c";
  if (align === "right" || align === "end") return "r";
  return "l";
}

function borderVisible(element: Element, side: "top" | "right" | "bottom" | "left"): boolean {
  const specific =
    styleProperty(element, `border-${side}`) ?? styleProperty(element, `border-${side}-style`);
  if (specific !== null) return VISIBLE_BORDER.test(specific);
  const all = styleProperty(element, "border") ?? styleProperty(element, "border-style");
  return all !== null && VISIBLE_BORDER.test(all);
}

function columnAlignments(grid: GridCell[][], width: number): ("l" | "c" | "r")[] {
  return Array.from({ length: width }, (_column, index) => {
    const origin = grid
      .map((row) => row[index])
      .find((cell) => cell?.rowOffset === 0 && cell.colOffset === 0);
    return origin ? cellAlignment(origin.element) : "l";
  });
}

function verticalBars(grid: GridCell[][], width: number, all: boolean): boolean[] {
  const first = grid[0] ?? [];
  return Array.from({ length: width + 1 }, (_bar, index) => {
    if (all) return true;
    const left = index < width ? first[index] : undefined;
    const right = index > 0 ? first[index - 1] : undefined;
    return (
      (left !== undefined && borderVisible(left.element, "left")) ||
      (right !== undefined && borderVisible(right.element, "right"))
    );
  });
}

function rowHasBorder(row: GridCell[], side: "top" | "bottom"): boolean {
  const origins = row.filter(
    (cell) =>
      cell?.colOffset === 0 &&
      (side === "top" ? cell.rowOffset === 0 : cell.rowOffset === cell.rowspan - 1),
  );
  return origins.length > 0 && origins.every((cell) => borderVisible(cell.element, side));
}

function renderCellContent(element: Element): string {
  const text = renderBlocks(element, { inTable: true }).join(" ");
  if (tagOf(element) === "th" && text !== "" && !text.startsWith(String.raw`\textbf{`)) {
    return String.raw`\textbf{${text}}`;
  }
  return text;
}

function multicolumnSpec(bars: boolean[], index: number, colspan: number, align: string): string {
  return `${bars[index] ? "|" : ""}${align}${bars[index + colspan] ? "|" : ""}`;
}

function renderGridCell(cell: GridCell, index: number, bars: boolean[]): string | null {
  if (cell.colOffset > 0) return null;
  const align = cellAlignment(cell.element);
  if (cell.rowOffset > 0) {
    return cell.colspan > 1
      ? String.raw`\multicolumn{${cell.colspan}}{${multicolumnSpec(bars, index, cell.colspan, align)}}{}`
      : "";
  }
  let content = renderCellContent(cell.element);
  if (cell.rowspan > 1) content = String.raw`\multirow{${cell.rowspan}}{*}{${content}}`;
  if (cell.colspan > 1) {
    content = String.raw`\multicolumn{${cell.colspan}}{${multicolumnSpec(bars, index, cell.colspan, align)}}{${content}}`;
  }
  return content;
}

function renderRow(row: GridCell[], width: number, bars: boolean[]): string {
  const cells: string[] = [];
  for (let index = 0; index < width; index++) {
    const cell = row[index];
    if (!cell) {
      cells.push("");
      continue;
    }
    const rendered = renderGridCell(cell, index, bars);
    if (rendered !== null) cells.push(rendered);
  }
  return `${cells.join(" & ")} \\\\`;
}

function tabularLines(table: Element): string[] {
  const grid = layoutGrid(tableRowElements(table));
  const width = Math.max(1, ...grid.map((row) => row.length));
  const border = table.getAttribute("border");
  const all = border !== null && border !== "" && border !== "0";
  const bars = verticalBars(grid, width, all);
  const aligns = columnAlignments(grid, width);
  const columns = aligns.map((align, index) => `${bars[index] ? "|" : ""}${align}`).join("");
  const spec = `${columns}${bars[width] ? "|" : ""}`;
  const lines = [String.raw`\begin{tabular}{${spec}}`];
  grid.forEach((row, index) => {
    const above =
      all || rowHasBorder(row, "top") || (index > 0 && rowHasBorder(grid[index - 1], "bottom"));
    if (above) lines.push(String.raw`${INDENT}\hline`);
    lines.push(`${INDENT}${renderRow(row, width, bars)}`);
  });
  const last = grid.at(-1);
  if (last && (all || rowHasBorder(last, "bottom"))) lines.push(String.raw`${INDENT}\hline`);
  lines.push(String.raw`\end{tabular}`);
  return lines;
}

function renderTable(table: Element, context: Context): string {
  const tabular = tabularLines(table);
  const caption = Array.from(table.children).find((child) => tagOf(child) === "caption");
  if (!caption || context.inTable) return tabular.join("\n");
  const captionText = normalizeSpace(renderChildrenInline(caption, { inTable: true }));
  return [
    String.raw`\begin{table}[htbp]`,
    String.raw`${INDENT}\centering`,
    String.raw`${INDENT}\caption{${captionText}}`,
    ...tabular.map((line) => `${INDENT}${line}`),
    String.raw`\end{table}`,
  ].join("\n");
}

export function htmlToLatex(html: string, options: HtmlToLatexOptions = {}): string | null {
  if (typeof DOMParser === "undefined") return null;
  const parsed = new DOMParser().parseFromString(DOMPurify.sanitize(html), "text/html");
  const lone = loneElement(parsed.body);
  const loneTag = lone ? tagOf(lone) : null;
  if (options.hasFiles && !isOfficeDocument(html) && loneTag !== "table") return null;
  if (loneTag === "pre") return null;
  const text = renderBlocks(parsed.body, { inTable: false }).join("\n\n").trim();
  return text === "" ? null : text;
}
