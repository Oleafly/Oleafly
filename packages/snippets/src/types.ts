export type Expand = "list" | "tab" | "auto";
export type Place = "any" | "text" | "math" | "inline-math" | "display-math" | "code";
export type ResolvedPlace = "text" | "inline-math" | "display-math" | "code";
export type SnippetLanguage = "latex" | "typst" | "markdown" | "bibtex" | "notes";
export type LayerId = "builtin" | "pack" | "user" | "project";
export type ProjectFieldKind = "image" | "label" | "cite" | "ref" | "file";
export type Helper = "slug" | "lower" | "upper" | "title" | "initials";

export const EXPANDS: readonly Expand[] = ["list", "tab", "auto"];
export const PLACES: readonly Place[] = ["any", "text", "math", "inline-math", "display-math", "code"];
export const SNIPPET_LANGUAGES: readonly SnippetLanguage[] = ["latex", "typst", "markdown", "bibtex", "notes"];
export const LAYERS: readonly LayerId[] = ["builtin", "pack", "user", "project"];
export const PROJECT_FIELD_KINDS: readonly ProjectFieldKind[] = ["image", "label", "cite", "ref", "file"];
export const HELPERS: readonly Helper[] = ["slug", "lower", "upper", "title", "initials"];

export interface RegexTransform {
  source: string;
  format: string;
  flags: string;
}

export type BodyNode =
  | { kind: "text"; text: string }
  | { kind: "field"; index: number; placeholder: BodyNode[] }
  | { kind: "choice"; index: number; options: string[] }
  | { kind: "project"; index: number; field: ProjectFieldKind; placeholder: string }
  | { kind: "mirror"; index: number; helper?: Helper; regex?: RegexTransform }
  | { kind: "variable"; name: string; format?: string; regex?: RegexTransform; fallback: BodyNode[] }
  | { kind: "capture"; group: number };

export type BodyErrorCode = "unclosed" | "bad-field" | "unknown-helper" | "unknown-project-field" | "bad-transform";

export interface BodyError {
  offset: number;
  code: BodyErrorCode;
  message: string;
}

export interface BodyParseResult {
  nodes: BodyNode[];
  errors: BodyError[];
}

export interface SnippetRecord {
  id: string;
  name: string;
  nameKey?: string;
  description?: string;
  trigger: string | null;
  aliases: string[];
  regex: RegExp | null;
  expand: Expand;
  languages: SnippetLanguage[] | "any";
  place: Place;
  inWord: boolean;
  lineStart: boolean;
  priority: number;
  bodies: Partial<Record<SnippetLanguage | "default", BodyNode[]>>;
  wraps: boolean;
  typstSince?: [number, number];
  collection: string;
  layer: LayerId;
}

export type SnippetProblemCode =
  | BodyErrorCode
  | "json"
  | "not-object"
  | "entry-not-object"
  | "bad-value"
  | "no-body"
  | "bad-regex"
  | "no-language"
  | "ordinary-words"
  | "regex-every-key"
  | "header"
  | "unreadable";

export interface SnippetProblem {
  collection: string;
  line: number;
  id?: string;
  code: SnippetProblemCode;
  message: string;
  severity: "error" | "warning";
}

export interface PackHeader {
  name?: string;
  nameKey?: string;
  source?: string;
  licence?: string;
}

export interface ParsedSnippetFile {
  collection: string;
  records: SnippetRecord[];
  problems: SnippetProblem[];
  header?: PackHeader;
}

export function isOneOf<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (values as readonly string[]).includes(value);
}
