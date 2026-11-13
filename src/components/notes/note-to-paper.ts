import { imageWidthPercent, theoremEnvironmentsFromPreamble } from "@oleafly/wysiwyg";
import type { JSONContent } from "@tiptap/core";
import type { ProjectFileBytes } from "@/components/editor/figure-import";
import { i18n } from "@/i18n";
import { bytesToBase64, textToBase64 } from "@/lib/base64";
import { svgWithTextLabels } from "@/features/mermaid-export";
import { escapeLatexText } from "@/lib/file-links";
import { basename, numberedPath, relativeFilePath } from "@/lib/path-utils";
import { foldPath } from "@/lib/project-notes";
import { blockLabel, paintStillBlock } from "./block-views";
import { BOOKMARK_INFO, parseBookmark } from "./bookmark-block";
import { CHART_LEGEND_CLASS } from "./chart-block";
import { renderD2 } from "./d2-render";
import { noteBlockName } from "./note-blocks";
import { calloutLabel } from "./note-callouts";
import { type CitationGroup, citationGroups, inlineCitation } from "./note-citations";
import { scanToCharOrLineBreak } from "./note-link-format";
import { parseNoteMarkdown, serializeNoteMarkdown } from "./note-markdown";
import { imageSource } from "./note-path";
import { parseSmilesSource, structureMarkup } from "./smiles-block";
import { sanitizeSvg } from "./svg-block";
import { TIKZ_RENDERERS, tikzPreamble } from "./tikz-block";
import { type LatexPackage, type TikzKind, tikzFigure } from "./tikz-source";
import type { CitationItem } from "./types";

export type PaperFormat = "latex" | "typst" | "markdown";

type PaperCitations =
  | { readonly kind: "command" }
  | { readonly kind: "keys"; readonly known: (key: string) => boolean }
  | { readonly kind: "labels"; readonly entries: ReadonlyMap<string, CitationItem> };

export interface PaperPlace {
  readonly format: PaperFormat;
  readonly folder: string;
  readonly from: string;
  readonly taken: (path: string) => boolean;
  readonly citations: PaperCitations;
  readonly theorems?: ReadonlySet<string>;
  readonly inline?: boolean;
  readonly raster?: boolean;
  readonly rawLatex?: boolean;
  readonly shared?: boolean;
}

type ReadNoteFile = (path: string) => Promise<Uint8Array | null>;

export interface PaperText {
  readonly text: string;
  readonly files: readonly ProjectFileBytes[];
  readonly packages: readonly LatexPackage[];
}

interface Figure {
  svg: string;
  png?: string;
  caption: string;
}

const RASTER_SCALE = 3;
const WHITE = "#ffffff";
const LATEX_IMAGE = /\.(?:png|jpe?g|pdf|eps)$/iu;
const DRAWN_STYLES = [
  "fill",
  "fill-opacity",
  "stroke",
  "stroke-width",
  "stroke-opacity",
  "stroke-dasharray",
  "stroke-linecap",
  "stroke-linejoin",
  "opacity",
  "font-family",
  "font-size",
  "font-weight",
  "text-anchor",
  "dominant-baseline",
];
const SCRIPT_MARKS: Readonly<Record<string, string>> = { superscript: "^", subscript: "~" };
const LATEX_UNSAFE_KEY = /[#$%&~]/u;
const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const LEGEND = { edge: 8, row: 18, swatch: 8, gap: 14, character: 6.2, size: 11, ink: "#52525b" };

export function preambleTheorems(source: string): ReadonlySet<string> {
  return new Set(theoremEnvironmentsFromPreamble(source.split("\\begin{document}")[0]));
}

function text(value: string, marks?: JSONContent["marks"]): JSONContent {
  return marks?.length ? { type: "text", text: value, marks } : { type: "text", text: value };
}

function raw(source: string, marks?: JSONContent["marks"]): JSONContent {
  return marks?.length ? { type: "rawInline", attrs: { source }, marks } : { type: "rawInline", attrs: { source } };
}

function rawBlock(format: string, lines: readonly string[]): JSONContent {
  const longest = Math.max(2, ...lines.flatMap((line) => (line.match(/`+/gu) ?? []).map((run) => run.length)));
  const fence = "`".repeat(longest + 1);
  return { type: "rawBlock", attrs: { source: [`${fence}{=${format}}`, ...lines, fence].join("\n") } };
}

function paragraph(content: JSONContent[]): JSONContent {
  return { type: "paragraph", content };
}

function plainText(nodes: readonly JSONContent[] | undefined): string {
  return (nodes ?? []).map((node) => node.text ?? (node.content ? plainText(node.content) : "")).join("");
}

function leftOut(label: string): JSONContent {
  return paragraph([text(i18n.t(($) => $.notes.sendToPaper.leftOut, { block: label }), [{ type: "italic" }])]);
}

function svgDocument(svg: SVGSVGElement): string {
  const box = svg.viewBox.baseVal;
  if (box?.width && !svg.getAttribute("width")) svg.setAttribute("width", String(box.width));
  if (box?.height && !svg.getAttribute("height")) svg.setAttribute("height", String(box.height));
  return new XMLSerializer().serializeToString(svg);
}

function drawLegend(svg: SVGSVGElement, legend: Element | null): void {
  const entries = [...(legend?.querySelectorAll("li") ?? [])];
  const [left, top, width, height] = (svg.getAttribute("viewBox") ?? "").split(/[\s,]+/u).map(Number);
  if (!legend || entries.length === 0 || !(width > 0) || !(height > 0)) return;
  const look = getComputedStyle(legend);
  const ink = look.color || LEGEND.ink;
  let x = left + LEGEND.edge;
  let row = 0;
  for (const entry of entries) {
    const label = entry.textContent ?? "";
    const room = LEGEND.swatch + 6 + label.length * LEGEND.character;
    if (x > left + LEGEND.edge && x + room > left + width - LEGEND.edge) {
      x = left + LEGEND.edge;
      row += 1;
    }
    const y = top + height + 6 + row * LEGEND.row;
    const swatch = document.createElementNS(SVG_NAMESPACE, "rect");
    const color = entry.firstElementChild ? getComputedStyle(entry.firstElementChild).backgroundColor : "";
    for (const [name, value] of Object.entries({ x, y, width: LEGEND.swatch, height: LEGEND.swatch, rx: 1, fill: color || ink })) {
      swatch.setAttribute(name, String(value));
    }
    const text = document.createElementNS(SVG_NAMESPACE, "text");
    for (const [name, value] of Object.entries({ x: x + LEGEND.swatch + 6, y: y + LEGEND.swatch, fill: ink, "font-size": LEGEND.size })) {
      text.setAttribute(name, String(value));
    }
    text.setAttribute("font-family", look.fontFamily || "sans-serif");
    text.textContent = label;
    svg.append(swatch, text);
    x += room + LEGEND.gap;
  }
  svg.setAttribute("viewBox", `${left} ${top} ${width} ${height + 6 + (row + 1) * LEGEND.row}`);
}

function paintedFigure(kind: string, source: string): Figure | null {
  const host = document.createElement("div");
  host.className = "light";
  host.setAttribute("aria-hidden", "true");
  host.style.cssText = "position: fixed; left: -100000px; top: 0; width: 640px; color: var(--foreground)";
  document.body.append(host);
  try {
    const dispose = paintStillBlock(kind, host, source);
    const drawn = host.querySelector("svg");
    if (!drawn) {
      dispose();
      return null;
    }
    for (const node of [drawn, ...drawn.querySelectorAll("*")]) {
      const computed = getComputedStyle(node);
      const style = DRAWN_STYLES.map((name) => [name, computed.getPropertyValue(name)] as const)
        .filter(([, value]) => value !== "")
        .map(([name, value]) => `${name}: ${value}`)
        .join("; ");
      if (style) node.setAttribute("style", style);
      node.removeAttribute("class");
    }
    drawLegend(drawn, host.querySelector(`.${CHART_LEGEND_CLASS}`));
    const caption = drawn.getAttribute("aria-label") ?? "";
    const svg = svgDocument(drawn);
    dispose();
    return { svg, caption: caption === blockLabel(kind) ? "" : caption };
  } finally {
    host.remove();
  }
}

function isTikz(kind: string): kind is TikzKind {
  return kind === "tikz" || kind === "circuitikz";
}

async function drawnFigures(kind: string, source: string, fence: string, read: ReadNoteFile, shared: boolean): Promise<Figure[] | null> {
  if (kind === "mermaid") {
    const { renderMermaidFigure } = await import("@/components/diagram/mermaid-render");
    const { svg, pngBase64 } = await renderMermaidFigure(source, { scale: RASTER_SCALE, background: WHITE });
    return [{ svg, png: pngBase64, caption: "" }];
  }
  if (kind === "smiles") {
    const { default: library } = await import("smiles-drawer");
    const drawer = new library.SvgDrawer({ width: 300, height: 300 });
    return parseSmilesSource(source).entries.flatMap((entry) => {
      try {
        return [{ svg: structureMarkup(library, drawer, entry.smiles, "light"), caption: entry.name ?? entry.smiles }];
      } catch {
        return [];
      }
    });
  }
  if (kind === "svg" || kind === "d2") {
    const result = sanitizeSvg(kind === "d2" ? svgWithTextLabels(await renderD2(source.trim(), "light")) : source);
    return result.ok ? [{ svg: result.svg, caption: "" }] : null;
  }
  if (isTikz(kind)) return [{ svg: await TIKZ_RENDERERS[kind].svg(source, { cachedOnly: shared }), caption: "" }];
  if (kind === "chart" || kind === "plot") {
    const figure = paintedFigure(kind, source);
    return figure ? [figure] : null;
  }
  if (kind === "typst") {
    const { typstSvg } = await import("./typst-block");
    return [{ svg: await typstSvg(source), caption: "" }];
  }
  if (kind === "molecule") {
    const { moleculeSnapshot } = await import("./molecule-block");
    const readFile = async (path: string) => {
      const bytes = await read(path);
      return bytes ? `data:application/octet-stream;base64,${bytesToBase64(bytes)}` : null;
    };
    const png = await moleculeSnapshot(source, fence, readFile);
    return png ? [{ svg: "", png, caption: "" }] : null;
  }
  return null;
}

class PaperDraft {
  readonly files: ProjectFileBytes[] = [];
  readonly packages: LatexPackage[] = [];
  private readonly chosen = new Set<string>();

  constructor(
    readonly place: PaperPlace,
    private readonly read: ReadNoteFile,
  ) {}

  private add(name: string, dataBase64: string): string {
    if (this.place.inline) return `data:${/\.svg$/iu.test(name) ? "image/svg+xml" : "image/png"};base64,${dataBase64}`;
    const candidate = this.place.folder ? `${this.place.folder}/${name}` : name;
    const path = numberedPath(candidate, (option) => this.place.taken(option) || this.chosen.has(foldPath(option)));
    this.chosen.add(foldPath(path));
    this.files.push({ path, dataBase64 });
    return relativeFilePath(this.place.from, path);
  }

  private get raster(): boolean {
    return this.place.raster ?? this.place.format === "latex";
  }

  private async svgFile(stem: string, figure: Figure): Promise<string> {
    if (!this.raster && figure.svg) return this.add(`${stem}.svg`, textToBase64(figure.svg));
    if (figure.png) return this.add(`${stem}.png`, figure.png);
    const { svgDocumentToPngBytes } = await import("@/features/equation-export");
    return this.add(`${stem}.png`, bytesToBase64(await svgDocumentToPngBytes(figure.svg, RASTER_SCALE, WHITE)));
  }

  async asset(src: string): Promise<string | null> {
    const source = imageSource(src);
    if (!source || !("path" in source)) return null;
    const bytes = await this.read(source.path).catch(() => null);
    if (!bytes) return null;
    const name = basename(source.path);
    if (!this.raster || LATEX_IMAGE.test(name)) return this.add(name, bytesToBase64(bytes));
    if (!/\.svg$/iu.test(name)) return null;
    return this.svgFile(name.replace(/\.svg$/iu, ""), { svg: new TextDecoder().decode(bytes), caption: "" });
  }

  figure(reference: string, caption: string, width: number | null = null): JSONContent {
    if (this.place.format !== "latex") return { type: "image", attrs: { src: reference, alt: caption || null, widthPercent: width } };
    return rawBlock("latex", [
      String.raw`\begin{figure}[htbp]`,
      String.raw`  \centering`,
      String.raw`  \includegraphics[width=${width === null || width === 100 ? "" : String(width / 100)}\linewidth]{${reference}}`,
      ...(caption ? [String.raw`  \caption{${escapeLatexText(caption)}}`] : []),
      String.raw`\end{figure}`,
    ]);
  }

  private require(packages: readonly LatexPackage[]): void {
    for (const entry of packages) {
      if (!this.packages.some((known) => known.name === entry.name)) this.packages.push(entry);
    }
  }

  async drawn(kind: string, source: string, fence = kind): Promise<JSONContent[]> {
    if (kind === "latex") return [{ type: "rawBlock", attrs: { source: `$$\n${source.trim()}\n$$` } }];
    if (isTikz(kind) && (this.place.format === "latex" || this.place.rawLatex)) {
      const figure = tikzFigure(source, kind, tikzPreamble());
      this.require(figure.packages);
      return [rawBlock("latex", figure.lines)];
    }
    if (kind === "typst" && this.place.format === "typst") return [rawBlock("typst", [source.trimEnd()])];
    const bookmark = kind === BOOKMARK_INFO ? parseBookmark(source) : null;
    if (bookmark) return [paragraph([text(bookmark.title ?? bookmark.url, [{ type: "link", attrs: { href: bookmark.url } }])])];
    const figures = await drawnFigures(kind, source, fence, this.read, this.place.shared === true).catch(() => null);
    if (!figures?.length) return [leftOut(blockLabel(kind))];
    return this.figureBlocks(kind, figures, 0, []);
  }

  private async figureBlocks(kind: string, figures: readonly Figure[], from: number, blocks: JSONContent[]): Promise<JSONContent[]> {
    if (from >= figures.length) return blocks;
    const figure = figures[from];
    blocks.push(this.figure(await this.svgFile(kind, figure), figure.caption));
    return this.figureBlocks(kind, figures, from + 1, blocks);
  }
}

function citeCommand(item: CitationGroup["items"][number]): string {
  const prefix = item.prefix ? `${escapeLatexText(item.prefix)} ` : "";
  const locator = item.locator ? `[${escapeLatexText(item.locator)}]` : "";
  return String.raw`${prefix}\cite${locator}{${item.key}}`;
}

function citation(group: CitationGroup, place: PaperPlace, marks: JSONContent["marks"], source: string): JSONContent {
  const { citations } = place;
  if (citations.kind === "labels") {
    return group.items.every((item) => citations.entries.has(item.key)) ? text(inlineCitation(group, citations.entries), marks) : text(source, marks);
  }
  if (citations.kind === "command") {
    if (group.items.some((item) => LATEX_UNSAFE_KEY.test(item.key))) return text(source, marks);
    const plain = group.items.every((item) => !item.prefix && !item.locator);
    return raw(plain ? String.raw`\cite{${group.items.map((item) => item.key).join(",")}}` : group.items.map(citeCommand).join("; "), marks);
  }
  if (group.items.every((item) => citations.known(item.key))) return text(source, marks);
  return raw(source.replaceAll(/[[\]@]/gu, (character) => `\\${character}`), marks);
}

function wikiLinkLabel(inner: string): string {
  const pipe = inner.indexOf("|");
  const head = pipe < 0 ? inner : inner.slice(0, pipe);
  const alias = pipe < 0 ? undefined : inner.slice(pipe + 1);
  const hash = head.indexOf("#");
  const target = hash < 0 ? head : head.slice(0, hash);
  const heading = hash < 0 ? undefined : head.slice(hash + 1);
  return (alias ?? (heading ? `${target} ${heading}` : target)).trim();
}

function withWikiLinksAsText(value: string): string {
  let out = "";
  let from = 0;
  let open = value.indexOf("[[");
  while (open >= 0) {
    const stop = scanToCharOrLineBreak(value, open + 2, "]");
    if (stop >= value.length) break;
    if (value[stop] === "]" && value[stop + 1] === "]") {
      const start = open > from && value[open - 1] === "!" ? open - 1 : open;
      out += value.slice(from, start) + wikiLinkLabel(value.slice(open + 2, stop));
      from = stop + 2;
    }
    open = value.indexOf("[[", Math.max(from, stop + 1));
  }
  return out + value.slice(from);
}

function plainTextRuns(value: string, marks: JSONContent["marks"], place: PaperPlace): JSONContent[] {
  const unlinked = withWikiLinksAsText(value);
  const nodes: JSONContent[] = [];
  let at = 0;
  for (const group of citationGroups(unlinked)) {
    if (group.from > at) nodes.push(text(unlinked.slice(at, group.from), marks));
    nodes.push(citation(group, place, marks, unlinked.slice(group.from, group.to)));
    at = group.to;
  }
  if (at < unlinked.length) nodes.push(text(unlinked.slice(at), marks));
  return nodes;
}

function keptMark(mark: { type: string; attrs?: Record<string, unknown> }): boolean {
  if (mark.type === "highlight") return false;
  const href = mark.attrs?.href;
  return !(mark.type === "link" && typeof href === "string" && href.startsWith("oleafly://"));
}

function inlineNodes(nodes: readonly JSONContent[], draft: PaperDraft): JSONContent[] {
  const result: JSONContent[] = [];
  for (const node of nodes) {
    if (node.type !== "text" || !node.text) {
      result.push(node);
      continue;
    }
    const marks = (node.marks ?? []).filter(keptMark);
    const script = marks.find((mark) => mark.type in SCRIPT_MARKS);
    if (script) {
      const symbol = SCRIPT_MARKS[script.type];
      const escaped = node.text.replaceAll(/[\\^~ ]/gu, (character) => `\\${character}`);
      result.push(raw(`${symbol}${escaped}${symbol}`, marks.filter((mark) => mark !== script)));
    } else if (marks.some((mark) => mark.type === "code")) {
      result.push(text(node.text, marks));
    } else {
      result.push(...plainTextRuns(node.text, marks, draft.place));
    }
  }
  return result;
}

async function calloutBlocks(node: JSONContent, draft: PaperDraft): Promise<JSONContent[]> {
  const [title, ...body] = node.content ?? [];
  const blocks = await blockNodes(body, draft);
  const type = String(node.attrs?.type ?? "note").toLowerCase();
  const heading = inlineNodes(title?.content ?? [], draft);
  if (draft.place.format === "latex" && draft.place.theorems?.has(type)) {
    const name = plainText(title?.content);
    const option = name ? `[${escapeLatexText(name)}]` : "";
    return [rawBlock("latex", [String.raw`\begin{${type}}${option}`]), ...blocks, rawBlock("latex", [String.raw`\end{${type}}`])];
  }
  const label = heading.length > 0 ? heading : [text(calloutLabel(type))];
  const bold = label.map((child) => ({ ...child, marks: [...(child.marks ?? []), { type: "bold" }] }));
  return [{ type: "blockquote", content: [paragraph(bold), ...blocks] }];
}

function unmarked(node: JSONContent): JSONContent {
  return node.attrs?.blockId ? { ...node, attrs: { ...node.attrs, blockId: null } } : node;
}

async function blockNode(node: JSONContent, draft: PaperDraft): Promise<JSONContent[]> {
  if (node.type === "image") {
    const reference = await draft.asset(String(node.attrs?.src ?? ""));
    const alt = String(node.attrs?.alt ?? "");
    return [
      reference === null
        ? paragraph([text(alt || String(node.attrs?.src ?? ""))])
        : draft.figure(reference, alt, imageWidthPercent(node.attrs?.widthPercent)),
    ];
  }
  const kind = node.type === "codeBlock" ? noteBlockName(String(node.attrs?.language ?? "")) : undefined;
  if (kind) return draft.drawn(kind, plainText(node.content), String(node.attrs?.language ?? ""));
  if (node.type === "callout") return calloutBlocks(node, draft);
  if (node.type === "codeBlock" || !node.content) return [unmarked(node)];
  if (node.content.some((child) => child.type === "text")) return [{ ...unmarked(node), content: inlineNodes(node.content, draft) }];
  return [{ ...unmarked(node), content: await blockNodes(node.content, draft) }];
}

async function blockNodes(nodes: readonly JSONContent[], draft: PaperDraft, from = 0, result: JSONContent[] = []): Promise<JSONContent[]> {
  if (from >= nodes.length) return result;
  result.push(...(await blockNode(nodes[from], draft)));
  return blockNodes(nodes, draft, from + 1, result);
}

export async function notePaperText(markdown: string, read: ReadNoteFile, place: PaperPlace): Promise<PaperText> {
  const { doc } = parseNoteMarkdown(markdown);
  const draft = new PaperDraft(place, read);
  const content = await blockNodes(doc.content ?? [], draft);
  return { text: serializeNoteMarkdown({ ...doc, content }).trim(), files: draft.files, packages: draft.packages };
}

export function hasCitations(markdown: string): boolean {
  return citationGroups(markdown).length > 0;
}
