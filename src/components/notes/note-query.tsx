import { Bot, CircleDot, FolderOpen, Hash, Shapes, Star, TextSearch, UserRound } from "lucide-react";
import { useMemo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  analyze,
  compile,
  defineSchema,
  expandQuery,
  flagField,
  formatValue,
  inRange,
  mergeExtensions,
  normalizeText,
  readFacet,
  truncatedDiagnostic,
  writeFacet,
  type AnalyzedQuery,
  type AnalyzedTerm,
  type Facet,
  type FacetOption,
  type SearchContext,
  type SearchExtension,
  type SearchField,
  type SearchSchema,
  type TextScope,
} from "@oleafly/search-query";
import { compareText } from "@/lib/intl";
import type { QueryMeta } from "@/lib/query-suggestions";
import type { NoteSearchHit, NoteTagCount } from "@/lib/tauri";
import { trimCharacter } from "@/lib/trim-character";
import { cn } from "@/lib/utils";
import { useNoteFavorites } from "@/store/notes-prefs";
import { artifactIcon, KIND_TONES, NoteIcon } from "./note-icons";
import { tagTone } from "./note-tags";
import { useNotesData } from "./notes-data";
import type { ArtifactItem, Author, NoteItem } from "./types";

type Translate = ReturnType<typeof useTranslation<["notes"]>>["t"];
type VaultTerm = AnalyzedTerm<VaultItem, QueryMeta>;

export type VaultItem = NoteItem | ArtifactItem;
export type VaultSchema = SearchSchema<VaultItem, QueryMeta>;
export type VaultQuery = AnalyzedQuery<VaultItem, QueryMeta>;
type NoteSearchExtension = SearchExtension<VaultItem, QueryMeta>;

export const VAULT_KINDS = ["note", "figure", "report", "data", "notebook"] as const;
export type VaultKind = (typeof VAULT_KINDS)[number];
export const VAULT_AUTHORS = ["agent", "you"] as const satisfies readonly Author[];

const INDEXED_FIELDS: ReadonlySet<string> = new Set(["tag", "title"]);
const PROJECT_SEPARATOR = "\u0000";

export interface NoteSearchState {
  readonly favorites: ReadonlySet<string>;
  readonly tags: readonly NoteTagCount[] | null;
  readonly projects: readonly string[];
}

export function isArtifact(item: VaultItem): item is ArtifactItem {
  return "taskId" in item;
}

export function tagFilterKey(tag: string): string {
  return trimCharacter(tag.trim().replace(/^#+/u, ""), "/").toLowerCase();
}

const icon = (Icon: typeof Hash, className?: string): ReactNode => <Icon className={cn("size-4", className)} />;

function kindIcon(kind: VaultKind): ReactNode {
  return kind === "note" ? <NoteIcon className={KIND_TONES.note.icon} /> : artifactIcon(kind);
}

function covers(tag: string, wanted: string): boolean {
  const key = normalizeText(tag);
  return key === wanted || key.startsWith(`${wanted}/`);
}

function tagTest(tags: readonly NoteTagCount[] | null): (item: VaultItem, needle: string) => boolean {
  const tagged = new Map<string, ReadonlySet<string>>();
  const notesUnder = (index: readonly NoteTagCount[], wanted: string) => {
    let ids = tagged.get(wanted);
    if (!ids) {
      ids = new Set(index.filter((entry) => covers(entry.tag, wanted)).flatMap((entry) => entry.notes));
      tagged.set(wanted, ids);
    }
    return ids;
  };
  return (item, needle) => {
    const wanted = tagFilterKey(needle);
    if (wanted === "") return true;
    if (isArtifact(item)) return false;
    return tags ? notesUnder(tags, wanted).has(item.id) : (item.tags ?? []).some((tag) => covers(tag, wanted));
  };
}

function names(item: VaultItem): readonly string[] {
  return isArtifact(item) ? [item.title] : [item.title, ...(item.aliases ?? [])];
}

function matchesKind(item: VaultItem, kind: string): boolean {
  if (!isArtifact(item)) return kind === "note";
  if (kind === "figure") return item.kind === "figure" || item.kind === "html";
  return item.kind === kind;
}

function inProject(item: VaultItem, needle: string): boolean {
  const id = isArtifact(item) ? item.projectId : item.relatedProjectId;
  return normalizeText(item.project) === needle || (id !== undefined && normalizeText(id) === needle);
}

const TEXT: TextScope<VaultItem, QueryMeta> = {
  value: "text",
  get: (item) => (isArtifact(item) ? item.title : [item.title, ...(item.aliases ?? []), item.preview ?? item.summary]),
};

function noteQualifiers(t: Translate, state: NoteSearchState): NoteSearchExtension {
  const authorLabel = (author: Author) => t(($) => $.notes.library.author[author]);
  return {
    is: [
      {
        value: "favorite",
        aliases: ["favourite", "favorites", "favourites", "starred"],
        meta: { label: t(($) => $.notes.vault.search.favorite), icon: icon(Star) },
        test: (item) => !isArtifact(item) && state.favorites.has(item.id),
      },
    ],
    fields: [
      {
        key: "tag",
        aliases: ["tags"],
        meta: { label: t(($) => $.notes.vault.search.fields.tag), icon: icon(Hash) },
        type: "text",
        options: (state.tags ?? []).map((entry) => ({ value: entry.tag, meta: { label: `#${entry.label}`, icon: icon(Hash, tagTone(entry.tag).icon) } })),
        test: tagTest(state.tags),
      },
      {
        key: "kind",
        aliases: ["type"],
        meta: { label: t(($) => $.notes.vault.search.fields.kind), icon: icon(Shapes) },
        type: "enum",
        options: VAULT_KINDS.map((kind) => ({ value: kind, meta: { label: t(($) => $.notes.library.kind[kind]), icon: kindIcon(kind) } })),
        test: matchesKind,
      },
      {
        key: "author",
        aliases: ["by"],
        meta: { label: t(($) => $.notes.vault.search.fields.author), icon: icon(UserRound) },
        type: "enum",
        options: [
          { value: "agent", aliases: ["agents", "ai"], meta: { label: authorLabel("agent"), icon: icon(Bot) } },
          { value: "you", aliases: ["me"], meta: { label: authorLabel("you"), icon: icon(UserRound) } },
        ],
        test: (item, value) => (isArtifact(item) ? "agent" : item.author) === value,
      },
      {
        key: "project",
        meta: { label: t(($) => $.notes.vault.search.fields.project), icon: icon(FolderOpen) },
        type: "text",
        options: state.projects.map((project) => ({ value: project, meta: { label: project, icon: icon(FolderOpen) } })),
        test: inProject,
      },
      {
        key: "title",
        meta: { label: t(($) => $.notes.vault.search.fields.title), icon: icon(TextSearch) },
        type: "text",
        test: (item, needle) => names(item).some((name) => normalizeText(name).includes(needle)),
      },
    ],
  };
}

export function buildNoteSearchSchema(t: Translate, state: NoteSearchState): VaultSchema {
  const parts = mergeExtensions([noteQualifiers(t, state)]);
  const fields: SearchField<VaultItem, QueryMeta>[] = [
    flagField("is", parts.is, { meta: { label: t(($) => $.notes.vault.search.fields.is), icon: icon(CircleDot) } }),
    ...parts.fields,
  ];
  return defineSchema({ fields, text: [TEXT, ...parts.text], sorts: parts.sorts });
}

interface Literal {
  readonly term: VaultTerm;
  readonly values: readonly string[];
  readonly search: string | null;
  readonly negated: boolean;
}

type Conjunction = readonly Literal[];

function textSearch(term: VaultTerm, source: string): string {
  const { token } = term;
  if (token.key) return source.slice(token.key.span.start, token.span.end);
  const [item] = token.items;
  return item.quoted ? `"${item.text}"` : item.text;
}

function literals(term: VaultTerm, source: string, negated: boolean): Conjunction[] | null {
  if (!term.valid) return null;
  if (term.role === "text") return [[{ term, values: term.values, search: textSearch(term, source), negated }]];
  const field = term.field;
  if (term.role !== "filter" || !field) return null;
  if (!INDEXED_FIELDS.has(field.key)) return [[{ term, values: term.values, search: null, negated }]];
  const each = term.token.items
    .filter((item) => item.text)
    .map((item, index): Literal => ({ term, values: [term.values[index]], search: `${field.key}:${formatValue(item.text)}`, negated }));
  return negated ? [each] : each.map((literal) => [literal]);
}

function holds(literal: Literal, item: VaultItem, context: SearchContext): boolean {
  const field = literal.term.field;
  if (!field) return literal.negated;
  let match: boolean;
  if (field.type === "enum" || field.type === "text") {
    const { test } = field;
    match = literal.values.some((value) => test(item, value, context));
  } else {
    const value = field.get(item);
    match = value != null && literal.term.ranges.some((range) => inRange(value, range));
  }
  return match !== literal.negated;
}

export interface VaultBranch {
  readonly search: string | null;
  readonly keep: (item: VaultItem) => boolean;
}

export interface VaultPlan {
  readonly fullText: boolean;
  readonly searches: readonly string[];
  readonly branches: readonly VaultBranch[];
  readonly test: (item: VaultItem) => boolean;
  readonly filtered: boolean;
  readonly truncated: boolean;
}

export function vaultPlan(query: VaultQuery, schema: VaultSchema, context: SearchContext): VaultPlan {
  const compiled = compile(query, schema, context);
  const expansion = expandQuery<Literal>(query.root, (token, negated) => {
    const term = query.termFor(token);
    return term ? literals(term, query.source, negated) : null;
  });
  let fullText = false;
  const branches = (expansion?.conjunctions ?? []).map((conjunction): VaultBranch => {
    const indexed = conjunction.filter((literal) => literal.search !== null);
    const local = conjunction.filter((literal) => literal.search === null);
    fullText ||= conjunction.some((literal) => literal.term.role === "text");
    return {
      search: indexed.length > 0 ? indexed.map((literal) => `${literal.negated ? "-" : ""}${literal.search}`).join(" ") : null,
      keep: (item) => local.every((literal) => holds(literal, item, context)),
    };
  });
  const searches = [...new Set(branches.flatMap((branch) => (branch.search === null ? [] : [branch.search])))];
  return { fullText, searches, branches, test: compiled.test, filtered: compiled.filtered, truncated: expansion?.truncated ?? false };
}

export function localHit(note: NoteItem): NoteSearchHit {
  return {
    id: note.id,
    noteId: null,
    title: note.title,
    titleRanges: [],
    score: 0,
    snippets: [],
    tags: [...(note.tags ?? [])],
    aliases: [...(note.aliases ?? [])],
    relatedProject: note.relatedProjectId ?? null,
    updatedAt: note.updatedAt,
  };
}

function bestHits(lists: Iterable<readonly NoteSearchHit[]>): NoteSearchHit[] {
  const best = new Map<string, NoteSearchHit>();
  for (const hits of lists) {
    for (const hit of hits) {
      const seen = best.get(hit.id);
      if (!seen || hit.score > seen.score) best.set(hit.id, hit);
    }
  }
  return [...best.values()].sort((left, right) => right.score - left.score);
}

export function mergeHits(
  plan: VaultPlan,
  results: readonly (readonly NoteSearchHit[])[],
  notes: readonly NoteItem[],
  limit: number,
): NoteSearchHit[] {
  const byId = new Map(notes.map((note) => [note.id, note]));
  const kept = plan.branches.map((branch) => {
    const hits = branch.search === null ? notes.map(localHit) : (results[plan.searches.indexOf(branch.search)] ?? []);
    return hits.filter((hit) => {
      const note = byId.get(hit.id);
      return note !== undefined && branch.keep(note);
    });
  });
  return bestHits(kept).slice(0, limit);
}

function single(key: string, value: string): FacetOption {
  return { id: value, term: { key, values: [value] } };
}

export const VAULT_FACETS = {
  kind: { keys: ["kind"], options: VAULT_KINDS.map((kind) => single("kind", kind)) },
  author: { keys: ["author"], options: VAULT_AUTHORS.map((author) => single("author", author)) },
} as const satisfies Record<string, Facet>;

function tagFacet(tags: readonly string[]): Facet {
  return { keys: ["tag"], options: tags.map((tag) => single("tag", tag)) };
}

export function selectedTag(query: VaultQuery): string | null {
  const typed = query.terms.flatMap((term) =>
    term.field?.key === "tag" ? term.token.items.map((item) => item.text.toLowerCase()) : [],
  );
  const state = readFacet(query, tagFacet(typed));
  return state.kind === "option" ? tagFilterKey(state.id) || null : null;
}

export function writeTagFilter(source: string, query: VaultQuery, tag: string | null): string {
  const key = tag ? tagFilterKey(tag) : "";
  return writeFacet(source, query, tagFacet(key ? [key] : []), key || null);
}

export function activeFilterCount(query: VaultQuery): number {
  return query.terms.filter((term) => term.role === "filter" && term.valid).length;
}

function projectNames(notes: readonly NoteItem[], artifacts: readonly ArtifactItem[]): string[] {
  return [...new Set([...notes, ...artifacts].map((item) => item.project).filter(Boolean))].sort(compareText);
}

export interface VaultSearchBox {
  readonly schema: VaultSchema;
  readonly query: VaultQuery;
  readonly plan: VaultPlan;
}

export function useVaultQuery(source: string, tags: readonly NoteTagCount[] | null): VaultSearchBox {
  const { t } = useTranslation(["notes"]);
  const { notes, artifacts } = useNotesData();
  const favorites = useNoteFavorites();
  const projectKey = useMemo(() => projectNames(notes, artifacts).join(PROJECT_SEPARATOR), [notes, artifacts]);
  const projects = useMemo(() => (projectKey === "" ? [] : projectKey.split(PROJECT_SEPARATOR)), [projectKey]);
  const schema = useMemo(
    () => buildNoteSearchSchema(t, { favorites, tags, projects }),
    [t, favorites, tags, projects],
  );
  return useMemo(() => {
    const context = { now: Date.now() };
    const query = analyze(source, schema, context);
    const plan = vaultPlan(query, schema, context);
    if (!plan.truncated) return { schema, query, plan };
    return { schema, query: { ...query, diagnostics: [...query.diagnostics, truncatedDiagnostic(source)] }, plan };
  }, [source, schema]);
}
