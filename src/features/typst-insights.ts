import { invoke } from "@tauri-apps/api/core";
import type { SyntaxNode, Tree } from "@lezer/common";
import { loadTypstParser, typstTools } from "@oleafly/editor/typst";
import type {
  CitationEntry,
  DocumentInsightsBase,
  InsightEntry,
  LabelEntry,
  SourceLocation,
  SubmissionMetadata,
  TodoEntry,
} from "./document-insights";

export { formatSubmissionMetadata, hasSubmissionMetadata } from "./document-insights";
export type { CitationEntry, InsightEntry, LabelEntry, SourceLocation, SubmissionMetadata, TodoEntry };

export type TypstInsightKind = "heading" | "figure" | "equation" | "citation";

export interface TypstInsightElement {
  kind: TypstInsightKind;
  text: string;
  label: string | null;
  level: number | null;
  figureKind: string | null;
  numbered: boolean;
  page: number | null;
}

export interface TypstQueryDiagnostic {
  message: string;
  file: string | null;
  line: number | null;
  column: number | null;
}

export type TypstDocumentInsightsResult =
  | {
      status: "ready";
      typstVersion: string;
      method: "query" | "eval";
      elements: TypstInsightElement[];
      truncated: boolean;
    }
  | {
      status: "failed";
      typstVersion: string;
      method: "query" | "eval";
      diagnostics: TypstQueryDiagnostic[];
    };

export interface TypstInsights extends DocumentInsightsBase {
  compiled: TypstDocumentInsightsResult | null;
}

interface SourceFile {
  path: string;
  text: string;
  tree: Tree;
}

interface SourceItem {
  kind: "heading" | "figure" | "equation";
  path: string;
  from: number;
  level: number;
  text: string;
  label: string | null;
  used: boolean;
}

interface SourceLabel {
  name: string;
  path: string;
  from: number;
}

interface SourceCitation {
  key: string;
  path: string;
  from: number;
}

interface SourceScan {
  items: SourceItem[];
  labels: SourceLabel[];
  citations: SourceCitation[];
  todos: TodoEntry[];
}

const TYPST_FILE = /\.typ$/iu;
const TODO_MARKER = /\b(?:TODO|FIXME|XXX)\b/u;
const MAX_TODO_CHARS = 160;
const TEMPLATE_FIELDS = new Set(["title", "author", "authors", "abstract", "keywords", "date"]);

export function fetchTypstDocumentInsights(
  projectId: string,
  offline: boolean,
  typstVariant: string | null = null,
): Promise<TypstDocumentInsightsResult> {
  return invoke<TypstDocumentInsightsResult>("typst_document_insights", {
    projectId,
    offline,
    ...(typstVariant ? { typstVariant } : {}),
  });
}

function tools() {
  const loaded = typstTools();
  if (!loaded) throw new Error("The Typst parser is not loaded.");
  return loaded;
}

function dirname(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? "" : path.slice(0, slash);
}

function normalizePath(path: string): string {
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return parts.join("/");
}

function unquote(literal: string): string {
  const body = literal.slice(1, -1);
  return body.replaceAll(/\\(["\\])/gu, "$1").replaceAll("\\n", "\n").replaceAll("\\t", "\t");
}

function children(node: SyntaxNode): SyntaxNode[] {
  const list: SyntaxNode[] = [];
  for (let child = node.firstChild; child; child = child.nextSibling) list.push(child);
  return list;
}

function includeTargets(file: SourceFile): string[] {
  const targets: string[] = [];
  file.tree.iterate({
    enter(node) {
      if (node.name !== "ModuleInclude") return undefined;
      const literal = node.node.getChild("Str");
      if (literal) {
        const target = unquote(file.text.slice(literal.from, literal.to));
        targets.push(normalizePath(target.startsWith("/") ? target : `${dirname(file.path)}/${target}`));
      }
      return false;
    },
  });
  return targets;
}

export function orderTypstSources(mainDoc: string, files: readonly SourceFile[]): SourceFile[] {
  const byPath = new Map(files.map((file) => [file.path, file]));
  const ordered: SourceFile[] = [];
  const seen = new Set<string>();
  const visit = (path: string) => {
    const file = byPath.get(path);
    if (!file || seen.has(path)) return;
    seen.add(path);
    ordered.push(file);
    for (const target of includeTargets(file)) visit(target);
  };
  visit(mainDoc);
  for (const file of [...files].sort((left, right) => left.path.localeCompare(right.path))) visit(file.path);
  return ordered;
}

function followingLabel(node: SyntaxNode, text: string): string | null {
  const next = node.nextSibling;
  if (next?.name !== "Label" || text.slice(node.to, next.from).includes("\n")) return null;
  return text.slice(next.from + 1, next.to - 1);
}

function calleeName(call: SyntaxNode, text: string): string | null {
  const callee = call.firstChild;
  return callee?.name === "Ident" ? text.slice(callee.from, callee.to) : null;
}

function namedArgument(args: SyntaxNode | null, text: string, name: string): SyntaxNode | null {
  if (!args) return null;
  for (const child of children(args)) {
    if (child.name !== "Named") continue;
    const key = child.firstChild;
    if (key && text.slice(key.from, key.to) === name) return child.getChild("Colon")?.nextSibling ?? null;
  }
  return null;
}

export function valueText(node: SyntaxNode | null, text: string): string | null {
  if (!node) return null;
  if (node.name === "Str") return unquote(text.slice(node.from, node.to));
  if (node.name === "ContentBlock") {
    const markup = node.getChild("Markup");
    return markup ? tools().typstPlainText(markup, text) : "";
  }
  if (node.name === "Dict") {
    return valueText(namedArgument(node, text, "name"), text);
  }
  if (node.name === "Ident" || node.name === "Auto" || node.name === "None") return null;
  return text.slice(node.from, node.to).trim() || null;
}

function valueList(node: SyntaxNode | null, text: string): string[] {
  if (!node) return [];
  if (node.name === "Array") {
    return children(node)
      .filter((child) => !["LeftParen", "RightParen", "Comma"].includes(child.name))
      .map((child) => valueText(child, text))
      .filter((value): value is string => !!value);
  }
  const single = valueText(node, text);
  return single ? [single] : [];
}

function isBlockEquation(node: SyntaxNode, text: string): boolean {
  const body = text.slice(node.from + 1, Math.max(node.from + 1, node.to - 1));
  return body.length > 0 && /^\s/u.test(body) && /\s$/u.test(body);
}

function lineOf(text: string, offset: number): { line: number; column: number } {
  let line = 1;
  let start = 0;
  for (let index = text.indexOf("\n"); index >= 0 && index < offset; index = text.indexOf("\n", index + 1)) {
    line += 1;
    start = index + 1;
  }
  return { line, column: offset - start + 1 };
}

function scanTodos(file: SourceFile, todos: TodoEntry[]): void {
  let offset = 0;
  for (const line of file.text.split("\n")) {
    const match = TODO_MARKER.exec(line);
    if (match) {
      const at = offset + match.index;
      const inner = file.tree.resolveInner(at, 1);
      if (inner.name !== "Str" && inner.name !== "Raw" && inner.parent?.name !== "Raw") {
        const rest = line.slice(match.index).replace(/\*\/\s*$/u, "").trim();
        todos.push({
          text: rest.length > MAX_TODO_CHARS ? `${rest.slice(0, MAX_TODO_CHARS)}…` : rest,
          location: { path: file.path, ...lineOf(file.text, at) },
        });
      }
    }
    offset += line.length + 1;
  }
}

function scanFile(file: SourceFile, scan: SourceScan): void {
  const { text, path } = file;
  const { typstHeadingLevel, typstPlainText } = tools();
  file.tree.iterate({
    enter(ref) {
      const node = ref.node;
      switch (node.name) {
        case "Heading":
          scan.items.push({
            kind: "heading",
            path,
            from: node.from,
            level: typstHeadingLevel(node),
            text: typstPlainText(node, text),
            label: followingLabel(node, text),
            used: false,
          });
          return undefined;
        case "Equation":
          if (isBlockEquation(node, text)) {
            scan.items.push({
              kind: "equation",
              path,
              from: node.from,
              level: 0,
              text: text.slice(node.from + 1, node.to - 1).trim(),
              label: followingLabel(node, text),
              used: false,
            });
          }
          return false;
        case "FuncCall": {
          const callee = calleeName(node, text);
          const args = node.getChild("Args");
          if (callee === "figure") {
            scan.items.push({
              kind: "figure",
              path,
              from: node.from,
              level: 0,
              text: valueText(namedArgument(args, text, "caption"), text) ?? "",
              label: followingLabel(node, text),
              used: false,
            });
          } else if (callee === "cite" && args) {
            const target = args.getChild("Label");
            if (target) scan.citations.push({ key: text.slice(target.from + 1, target.to - 1), path, from: node.from });
          }
          return undefined;
        }
        case "Ref": {
          const marker = node.getChild("RefMarker");
          if (marker) scan.citations.push({ key: text.slice(marker.from + 1, marker.to).replace(/[.:]+$/u, ""), path, from: node.from });
          return undefined;
        }
        case "Label":
          if (node.parent?.name !== "Args") {
            scan.labels.push({ name: text.slice(node.from + 1, node.to - 1), path, from: node.from });
          }
          return false;
        case "Raw":
        case "Str":
          return false;
        default:
          return undefined;
      }
    },
  });
  scanTodos(file, scan.todos);
}

function normalized(text: string): string {
  return text.toLowerCase().replaceAll(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function locate(files: ReadonlyMap<string, SourceFile>, path: string, from: number): SourceLocation {
  const text = files.get(path)?.text ?? "";
  return { path, ...lineOf(text, from) };
}

function takeItem(items: SourceItem[], accept: (item: SourceItem) => boolean): SourceItem | null {
  const found = items.find((item) => !item.used && accept(item));
  if (found) found.used = true;
  return found ?? null;
}

function matchElement(element: TypstInsightElement, scan: SourceScan): SourceItem | { path: string; from: number } | null {
  const kind = element.kind === "citation" ? null : element.kind;
  if (!kind) return null;
  const ofKind = scan.items.filter((item) => item.kind === kind);
  if (element.label) {
    const labelled = takeItem(ofKind, (item) => item.label === element.label);
    if (labelled) return labelled;
    const label = scan.labels.find((candidate) => candidate.name === element.label);
    if (label) return label;
  }
  const wanted = normalized(element.text);
  if (kind === "heading") {
    return takeItem(ofKind, (item) => normalized(item.text) === wanted && (element.level === null || item.level === element.level))
      ?? takeItem(ofKind, (item) => normalized(item.text) === wanted);
  }
  if (kind === "figure" && wanted) {
    const byCaption = takeItem(ofKind, (item) => !item.label && normalized(item.text) === wanted);
    if (byCaption) return byCaption;
  }
  return takeItem(ofKind, (item) => !item.label);
}

function preferredText(element: TypstInsightElement, match: ReturnType<typeof matchElement>): string {
  const source = match && "text" in match ? match.text : "";
  if (element.kind === "equation") return source || element.text;
  return element.text || source;
}

function entryKind(element: TypstInsightElement): InsightEntry["kind"] {
  if (element.kind === "figure") return element.figureKind === "table" ? "table" : "figure";
  return element.kind === "equation" ? "equation" : "heading";
}

function descendants(node: SyntaxNode, name: string): SyntaxNode[] {
  const list: SyntaxNode[] = [];
  const walk = (parent: SyntaxNode) => {
    for (let child = parent.firstChild; child; child = child.nextSibling) {
      if (child.name === name) list.push(child);
      walk(child);
    }
  };
  walk(node);
  return list;
}

function templateArguments(tree: Tree, text: string): Map<string, SyntaxNode> {
  const found = new Map<string, SyntaxNode>();
  for (const node of children(tree.topNode)) {
    if (node.name !== "ShowRule") continue;
    for (const named of descendants(node, "Named")) {
      const key = named.firstChild;
      if (!key) continue;
      const name = text.slice(key.from, key.to);
      const value = named.getChild("Colon")?.nextSibling;
      if (TEMPLATE_FIELDS.has(name) && value && !found.has(name)) found.set(name, value);
    }
  }
  return found;
}

function documentArguments(tree: Tree, text: string): Map<string, SyntaxNode> {
  const found = new Map<string, SyntaxNode>();
  for (const node of children(tree.topNode)) {
    if (node.name !== "SetRule") continue;
    const callee = node.getChild("Set")?.nextSibling;
    if (!callee || text.slice(callee.from, callee.to) !== "document") continue;
    for (const named of node.getChild("Args")?.getChildren("Named") ?? []) {
      const key = named.firstChild;
      const value = named.getChild("Colon")?.nextSibling;
      if (key && value) found.set(text.slice(key.from, key.to), value);
    }
  }
  return found;
}

function splitKeywords(values: string[]): string[] {
  if (values.length !== 1) return values;
  return values[0].split(/[,;]/u).map((value) => value.trim()).filter(Boolean);
}

function abstractUnderHeading(file: SourceFile): string | null {
  const { typstHeadings, parseTypst, typstPlainText } = tools();
  const headings = typstHeadings(file.tree);
  const index = headings.findIndex((heading) => normalized(typstPlainText(heading.node, file.text)) === "abstract");
  if (index < 0) return null;
  const start = headings[index].to;
  const end = headings.find((heading, position) => position > index && heading.level <= headings[index].level)?.from
    ?? file.text.length;
  const slice = file.text.slice(start, end);
  const plain = typstPlainText(parseTypst(slice).topNode, slice);
  return plain || null;
}

export function readSubmissionMetadata(main: SourceFile | null): SubmissionMetadata {
  const metadata: SubmissionMetadata = { title: null, authors: [], abstract: null, keywords: [], date: null };
  if (!main) return metadata;
  const document = documentArguments(main.tree, main.text);
  const template = templateArguments(main.tree, main.text);
  const pick = (...names: string[]) => {
    for (const source of [template, document]) {
      for (const name of names) {
        const value = source.get(name);
        if (value) return value;
      }
    }
    return null;
  };
  metadata.title = valueText(pick("title"), main.text);
  metadata.authors = valueList(pick("authors", "author"), main.text);
  metadata.keywords = splitKeywords(valueList(pick("keywords"), main.text));
  metadata.date = valueText(pick("date"), main.text);
  metadata.abstract = valueText(template.get("abstract") ?? null, main.text) ?? abstractUnderHeading(main);
  return metadata;
}

export async function parseTypstFiles(texts: Readonly<Record<string, string>>): Promise<SourceFile[]> {
  const parser = await loadTypstParser();
  return Object.entries(texts)
    .filter(([path]) => TYPST_FILE.test(path))
    .map(([path, text]) => ({ path, text, tree: parser.parse(text) }));
}

export async function buildTypstInsights(
  mainDoc: string,
  texts: Readonly<Record<string, string>>,
  compiled: TypstDocumentInsightsResult | null,
): Promise<TypstInsights> {
  const parsed = await parseTypstFiles(texts);
  const files = orderTypstSources(mainDoc, parsed);
  const byPath = new Map(files.map((file) => [file.path, file]));
  const scan: SourceScan = { items: [], labels: [], citations: [], todos: [] };
  for (const file of files) scanFile(file, scan);
  const insights: TypstInsights = {
    headings: [],
    figures: [],
    tables: [],
    equations: [],
    labels: [],
    citations: [],
    todos: scan.todos,
    metadata: readSubmissionMetadata(byPath.get(mainDoc) ?? null),
    compiled,
  };
  const elements = compiled?.status === "ready" ? compiled.elements : [];
  const citationCounts = new Map<string, number>();
  const labelled = new Set<string>();
  elements.forEach((element, index) => {
    if (element.kind === "citation") {
      citationCounts.set(element.text, (citationCounts.get(element.text) ?? 0) + 1);
      return;
    }
    const match = matchElement(element, scan);
    const entry: InsightEntry = {
      id: `${element.kind}-${index}`,
      kind: entryKind(element),
      text: preferredText(element, match),
      label: element.label,
      level: element.level,
      figureKind: element.figureKind,
      page: element.page,
      numbered: element.numbered,
      location: match ? locate(byPath, match.path, match.from) : null,
    };
    if (entry.kind === "heading") insights.headings.push(entry);
    else if (entry.kind === "table") insights.tables.push(entry);
    else if (entry.kind === "figure") insights.figures.push(entry);
    else insights.equations.push(entry);
    if (element.label && !labelled.has(element.label)) {
      labelled.add(element.label);
      const source = scan.labels.find((label) => label.name === element.label);
      insights.labels.push({
        name: element.label,
        kind: entry.kind,
        location: source ? locate(byPath, source.path, source.from) : entry.location,
      });
    }
  });
  for (const label of scan.labels) {
    if (labelled.has(label.name)) continue;
    labelled.add(label.name);
    insights.labels.push({ name: label.name, kind: "other", location: locate(byPath, label.path, label.from) });
  }
  for (const [key, count] of citationCounts) {
    const use = scan.citations.find((citation) => citation.key === key);
    insights.citations.push({ key, count, location: use ? locate(byPath, use.path, use.from) : null });
  }
  return insights;
}
