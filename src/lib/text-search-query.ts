import { analyze, defineSchema, expandQuery, type QueryExpansion, type SearchField, type SearchSchema } from "@oleafly/search-query";
import type { SearchMode } from "@/lib/search-modes";
import type { TextBranch, TextQuery, TextTerm } from "@/lib/tauri";

const MAX_BRANCHES = 32;
const INVALID_PATTERN = /^Not a valid pattern:\s*/u;
const ANY = () => true;

type FileField = TextTerm["kind"];

interface Literal {
  term: TextTerm;
  negated: boolean;
}

const FIELDS: readonly { key: Exclude<FileField, "text">; aliases: readonly string[] }[] = [
  { key: "path", aliases: ["in", "file"] },
  { key: "ext", aliases: ["type"] },
  { key: "project", aliases: [] },
];

const schemas = new Map<boolean, SearchSchema<unknown>>();

export function fileSearchSchema(allProjects: boolean): SearchSchema<unknown> {
  let schema = schemas.get(allProjects);
  if (!schema) {
    const fields: SearchField<unknown>[] = FIELDS.filter((field) => allProjects || field.key !== "project").map((field) => ({
      key: field.key,
      aliases: field.aliases,
      type: "text",
      test: ANY,
    }));
    schema = defineSchema({ fields, text: [{ value: "text", get: () => null }] });
    schemas.set(allProjects, schema);
  }
  return schema;
}

function branchOf(conjunction: readonly Literal[]): TextBranch {
  return {
    all: conjunction.filter((literal) => !literal.negated).map((literal) => literal.term),
    none: conjunction.filter((literal) => literal.negated).map((literal) => literal.term),
  };
}

function textExpansion(source: string, allProjects: boolean): QueryExpansion<Literal> | null {
  const query = analyze(source, fileSearchSchema(allProjects), { now: Date.now() });
  return expandQuery<Literal>(
    query.root,
    (token, negated) => {
      const term = query.termFor(token);
      if (!term?.valid) return null;
      const kind: FileField | null = term.role === "text" ? "text" : ((term.field?.key as FileField | undefined) ?? null);
      if (!kind) return null;
      const values = (
        kind === "text" && token.key ? [source.slice(token.key.span.start, token.span.end)] : token.items.map((item) => item.text)
      )
        .map((value) => value.trim())
        .filter(Boolean);
      if (values.length === 0) return null;
      const literals = values.map((value): Literal => ({ term: { kind, value }, negated }));
      return negated ? [literals] : literals.map((literal) => [literal]);
    },
    MAX_BRANCHES,
  );
}

export function textSearchTruncated(source: string, allProjects: boolean): boolean {
  return textExpansion(source, allProjects)?.truncated ?? false;
}

export function textSearchQuery(source: string, mode: SearchMode, allProjects: boolean, limit?: number): TextQuery | null {
  const conjunctions = textExpansion(source, allProjects)?.conjunctions ?? [];
  const branches = conjunctions.map(branchOf).filter((branch) => branch.all.length + branch.none.length > 0);
  if (branches.length === 0) return null;
  return limit === undefined ? { branches, mode } : { branches, mode, limit };
}

export function invalidPattern(message: string | null): string | null {
  return message && INVALID_PATTERN.test(message) ? message.replace(INVALID_PATTERN, "") : null;
}
