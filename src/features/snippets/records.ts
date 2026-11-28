import { editorMessageOr } from "@oleafly/editor/message-keys";
import {
  type BodyNode,
  type Expand,
  type ParsedSnippetFile,
  type Place,
  type RenderEnv,
  renderBody,
  type SnippetLanguage,
  type SnippetRecord,
  serializeBody,
} from "@oleafly/snippets";
import { i18n } from "@/i18n";
import { collectionOf, STATE_FILE } from "./store";

export const USER_COLLECTION = "my-snippets";

export function snippetName(record: SnippetRecord): string {
  return editorMessageOr(record.nameKey, record.name);
}

export function snippetFits(record: SnippetRecord, language: SnippetLanguage | null): boolean {
  return language !== null && (record.languages === "any" || record.languages.includes(language));
}

export function snippetBody(record: SnippetRecord, language: SnippetLanguage | null): BodyNode[] | null {
  const bodies = record.bodies;
  return (language ? bodies[language] : undefined) ?? bodies.default ?? Object.values(bodies).find(Boolean) ?? null;
}

export function snippetSource(record: SnippetRecord, language: SnippetLanguage | null): string {
  const body = snippetBody(record, language);
  return body ? serializeBody(body) : "";
}

const PLAIN_ENV: RenderEnv = {
  selection: "",
  clipboard: "",
  now: new Date(0),
  fileName: null,
  projectName: null,
  lineComment: "%",
  captures: [],
  indent: "",
  indentUnit: "  ",
};

export function snippetText(record: SnippetRecord, language: SnippetLanguage | null, now = new Date()): string {
  const body = snippetBody(record, language);
  return body ? renderBody(body, { ...PLAIN_ENV, now, lineComment: language === "latex" || language === "bibtex" ? "%" : "//" }).text : "";
}

const MATH_MARKERS: Partial<Record<SnippetLanguage, string>> = { typst: "square" };
const LATEX_MARKER = String.raw`\square`;

function markedFields(nodes: readonly BodyNode[], marker: string): BodyNode[] {
  return nodes.map((node) => {
    if (node.kind === "field" && node.placeholder.length > 0) return { ...node, placeholder: markedFields(node.placeholder, marker) };
    if (node.kind === "field" && node.index > 0) return { ...node, placeholder: [{ kind: "text", text: marker }] };
    if (node.kind === "project" && !node.placeholder) return { ...node, placeholder: marker };
    return node;
  });
}

export function snippetMathSource(record: SnippetRecord, language: SnippetLanguage | null): string {
  const body = snippetBody(record, language);
  if (!body) return "";
  const marker = (language && MATH_MARKERS[language]) ?? LATEX_MARKER;
  return renderBody(markedFields(body, marker), PLAIN_ENV).text.trim();
}

const searchTexts = new WeakMap<SnippetRecord, { readonly language: string; readonly text: string }>();

export function snippetSearchText(record: SnippetRecord): string {
  const cached = searchTexts.get(record);
  if (cached?.language === i18n.language) return cached.text;
  const bodies = Object.values(record.bodies).map((nodes) => serializeBody(nodes as BodyNode[]));
  const text = [snippetName(record), record.name, record.trigger ?? "", ...record.aliases, record.description ?? "", ...bodies]
    .join("\n")
    .toLowerCase();
  searchTexts.set(record, { language: i18n.language, text });
  return text;
}

export function searchTerms(query: string): readonly string[] {
  return query.toLowerCase().split(/\s+/u).filter(Boolean);
}

export function snippetMatchesTerms(record: SnippetRecord, terms: readonly string[]): boolean {
  if (terms.length === 0) return true;
  const text = snippetSearchText(record);
  return terms.every((term) => text.includes(term));
}

export function collectionName(collection: string, files: readonly ParsedSnippetFile[]): string {
  if (collection === USER_COLLECTION) return i18n.t(($) => $.shell.snippets.mySnippets);
  const header = files.find((file) => file.collection === collection)?.header;
  return editorMessageOr(header?.nameKey, header?.name ?? collection);
}

export function expandLabel(expand: Expand): string {
  return i18n.t(($) => $.shell.snippets.expands[expand]);
}

export function languageLabel(language: SnippetLanguage | "any"): string {
  return i18n.t(($) => $.shell.snippets.languages[language]);
}

export function placeLabel(place: Place): string {
  return i18n.t(($) => $.shell.snippets.places[place]);
}

export function isMathPlace(place: Place): boolean {
  return place === "math" || place === "inline-math" || place === "display-math";
}

export function userCollections(disk: readonly { name: string }[]): string[] {
  const names = disk.filter((file) => file.name !== STATE_FILE).map((file) => collectionOf(file.name));
  return [USER_COLLECTION, ...names.filter((name) => name !== USER_COLLECTION)];
}
