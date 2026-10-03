import type { ReactNode } from "react";
import type { useTranslation } from "react-i18next";
import {
  ArrowDownUp,
  BookmarkCheck,
  CalendarClock,
  CalendarDays,
  CalendarPlus,
  CircleCheck,
  CircleDot,
  CircleOff,
  Eye,
  FileCode2,
  FileDown,
  FileText,
  FolderOpen,
  GitFork,
  Image,
  Library,
  Palette,
  Shapes,
  TextSearch,
  History,
} from "lucide-react";
import {
  absenceField,
  defineSchema,
  flagField,
  type Facet,
  type SearchField,
  type SearchFlag,
  type SearchOption,
  type SearchSchema,
  type SortOrder,
  type TextScope,
} from "@oleafly/search-query";
import { BOOK_COLOR_OPTIONS } from "@/components/library/Book";
import {
  folderDisplayPath,
  isFolderProject,
  projectActivityAt,
  projectUpdatedAt,
} from "@/lib/library-projects";
import type { QueryMeta } from "@/lib/query-suggestions";
import type { ProjectInfo } from "@/lib/tauri";

type Translate = ReturnType<typeof useTranslation<["common", "library"]>>["t"];
type ProjectFlag = SearchFlag<ProjectInfo, QueryMeta>;
type ProjectEngine = "latex" | "typst" | "markdown";

export const PROJECT_ENGINES: readonly ProjectEngine[] = ["latex", "typst", "markdown"];
export const PROJECT_KINDS = ["document", "image", "diagram"] as const;
export const DEFAULT_PROJECT_SORT = "activity-desc";

const ENGINE_LABELS: Readonly<Record<ProjectEngine, string>> = {
  latex: "LaTeX",
  typst: "Typst",
  markdown: "Markdown",
};

export function projectEngine(project: Pick<ProjectInfo, "engine" | "main_doc">): ProjectEngine {
  const value = project.engine?.trim().toLowerCase();
  const path = project.main_doc.toLowerCase();
  if (value === "typst" || value === "typ" || path.endsWith(".typ")) return "typst";
  if (
    value === "markdown" ||
    value === "md" ||
    value === "pandoc" ||
    path.endsWith(".md") ||
    path.endsWith(".markdown")
  ) {
    return "markdown";
  }
  return "latex";
}

export function projectEngineLabel(project: Pick<ProjectInfo, "engine" | "main_doc">): string {
  return ENGINE_LABELS[projectEngine(project)];
}

export interface ProjectSearchState {
  readonly favorites: readonly string[];
  readonly modified: Readonly<Record<string, number>>;
  readonly colorOf: (project: ProjectInfo) => string;
  readonly colorLabels: Readonly<Record<string, string>>;
}

export interface ProjectSearchExtension {
  readonly is?: readonly ProjectFlag[];
  readonly has?: readonly ProjectFlag[];
  readonly fields?: readonly SearchField<ProjectInfo, QueryMeta>[];
  readonly sorts?: readonly SortOrder<ProjectInfo, QueryMeta>[];
  readonly text?: readonly TextScope<ProjectInfo, QueryMeta>[];
}

const icon = (Icon: typeof Eye): ReactNode => <Icon className="size-4" />;

function swatch(hex: string): ReactNode {
  return <span className="size-3 rounded-full border border-black/10 dark:border-white/15" style={{ background: hex }} />;
}

function seconds(value: number | undefined): number | null {
  return value ? value * 1000 : null;
}

function datePresets(t: Translate): SearchOption<QueryMeta>[] {
  const calendar = icon(CalendarDays);
  return [
    { value: "@today", meta: { label: t(($) => $.library.home.search.values.today), icon: calendar } },
    { value: "@today-1d", meta: { label: t(($) => $.library.home.search.values.yesterday), icon: calendar } },
    { value: ">@today-1w", meta: { label: t(($) => $.library.home.filters.last7Days), icon: calendar } },
    { value: ">@today-30d", meta: { label: t(($) => $.library.home.filters.last30Days), icon: calendar } },
    { value: ">@today-1y", meta: { label: t(($) => $.library.home.filters.lastYear), icon: calendar } },
  ];
}

function isFlags(t: Translate, state: ProjectSearchState): ProjectFlag[] {
  return [
    {
      value: "bookmarked",
      aliases: ["bookmark", "favorite", "favourite", "starred"],
      meta: { label: t(($) => $.library.home.filters.bookmarkYes), icon: icon(BookmarkCheck) },
      test: (project) => state.favorites.includes(project.id),
    },
    {
      value: "folder",
      aliases: ["linked", "external"],
      meta: { label: t(($) => $.library.home.search.values.linkedFolder), icon: icon(FolderOpen) },
      test: (project) => isFolderProject(project),
    },
    {
      value: "library",
      meta: { label: t(($) => $.library.home.filters.locationLibrary), icon: icon(Library) },
      test: (project) => !isFolderProject(project),
    },
    {
      value: "forked",
      aliases: ["fork"],
      meta: { label: t(($) => $.library.home.search.values.forked), icon: icon(GitFork) },
      test: (project) => project.forked_from !== null,
    },
  ];
}

function hasFlags(t: Translate): ProjectFlag[] {
  return [
    {
      value: "preview",
      aliases: ["pdf"],
      meta: { label: t(($) => $.library.home.filters.preview), icon: icon(Eye) },
      test: (project) => project.has_preview,
    },
    {
      value: "exports",
      aliases: ["export"],
      meta: { label: t(($) => $.library.home.search.values.exports), icon: icon(FileDown) },
      test: (project) => (project.exports ?? []).length > 0,
    },
  ];
}

function kindIcon(kind: (typeof PROJECT_KINDS)[number]): ReactNode {
  if (kind === "image") return icon(Image);
  if (kind === "diagram") return icon(Shapes);
  return icon(FileText);
}

function kindLabel(t: Translate, kind: (typeof PROJECT_KINDS)[number]): string {
  if (kind === "image") return t(($) => $.library.home.filters.kindImage);
  if (kind === "diagram") return t(($) => $.library.home.filters.kindDiagram);
  return t(($) => $.library.home.filters.kindDocument);
}

function valueFields(t: Translate, state: ProjectSearchState): SearchField<ProjectInfo, QueryMeta>[] {
  const presets = datePresets(t);
  return [
    {
      key: "engine",
      meta: { label: t(($) => $.library.home.filters.engine), icon: icon(FileCode2) },
      type: "enum",
      options: [
        { value: "latex", aliases: ["tectonic", "tex", "latexmk"], meta: { label: ENGINE_LABELS.latex, icon: icon(FileCode2) } },
        { value: "typst", aliases: ["typ"], meta: { label: ENGINE_LABELS.typst, icon: icon(FileCode2) } },
        { value: "markdown", aliases: ["md", "pandoc"], meta: { label: ENGINE_LABELS.markdown, icon: icon(FileCode2) } },
      ],
      test: (project, value) => projectEngine(project) === value,
    },
    {
      key: "kind",
      aliases: ["type"],
      meta: { label: t(($) => $.library.home.filters.kind), icon: icon(Shapes) },
      type: "enum",
      options: PROJECT_KINDS.map((kind) => ({ value: kind, meta: { label: kindLabel(t, kind), icon: kindIcon(kind) } })),
      test: (project, value) => (project.kind || "document") === value,
    },
    {
      key: "color",
      aliases: ["colour"],
      meta: { label: t(($) => $.library.home.search.fields.color), icon: icon(Palette) },
      type: "enum",
      options: BOOK_COLOR_OPTIONS.map(({ name, hex }) => ({
        value: name.toLowerCase(),
        meta: { label: state.colorLabels[name] ?? name, icon: swatch(hex) },
      })),
      test: (project, value) => {
        const hex = BOOK_COLOR_OPTIONS.find((option) => option.name.toLowerCase() === value)?.hex;
        return hex?.toLowerCase() === state.colorOf(project).toLowerCase();
      },
    },
    {
      key: "created",
      meta: { label: t(($) => $.library.home.filters.created), icon: icon(CalendarPlus) },
      type: "date",
      options: presets,
      get: (project) => seconds(project.created_at),
    },
    {
      key: "updated",
      aliases: ["modified"],
      meta: { label: t(($) => $.library.home.filters.modified), icon: icon(CalendarClock) },
      type: "date",
      options: presets,
      get: (project) => seconds(projectUpdatedAt(project, state.modified)),
    },
    {
      key: "opened",
      meta: { label: t(($) => $.library.home.search.fields.opened), icon: icon(History) },
      type: "date",
      options: presets,
      get: (project) => seconds(project.last_opened_at),
    },
  ];
}

function textScopes(t: Translate, state: ProjectSearchState): TextScope<ProjectInfo, QueryMeta>[] {
  const text = icon(TextSearch);
  return [
    { value: "name", aliases: ["title"], meta: { label: t(($) => $.library.home.columns.name), icon: text }, get: (project) => project.name },
    { value: "id", meta: { label: t(($) => $.library.home.search.values.id), icon: text }, get: (project) => project.id },
    {
      value: "file",
      aliases: ["main"],
      meta: { label: t(($) => $.library.home.search.values.mainFile), icon: text },
      get: (project) => project.main_doc,
    },
    {
      value: "path",
      aliases: ["folder"],
      meta: { label: t(($) => $.library.home.search.values.folderPath), icon: text },
      get: (project) => folderDisplayPath(project),
    },
    {
      value: "export",
      aliases: ["exports"],
      meta: { label: t(($) => $.library.home.search.values.exports), icon: text },
      get: (project) => (project.exports ?? []).flatMap((item) => [item.filename, item.format, item.path]),
    },
    {
      value: "details",
      hidden: true,
      get: (project) => {
        const name = BOOK_COLOR_OPTIONS.find((option) => option.hex === state.colorOf(project))?.name;
        return [projectEngineLabel(project), project.kind, name, name ? state.colorLabels[name] : undefined].filter(
          (part): part is string => Boolean(part),
        );
      },
    },
  ];
}

function sortOrders(t: Translate, state: ProjectSearchState): SortOrder<ProjectInfo, QueryMeta>[] {
  const sort = icon(ArrowDownUp);
  const meta = (label: string): QueryMeta => ({ label, icon: sort });
  const at = (value: number | null | undefined) => value ?? 0;
  return [
    {
      value: "activity",
      aliases: ["recent"],
      meta: meta(t(($) => $.library.home.search.sorts.activityDesc)),
      ascendingMeta: meta(t(($) => $.library.home.search.sorts.activityAsc)),
      compare: (a, b) => projectActivityAt(a, state.modified) - projectActivityAt(b, state.modified),
    },
    {
      value: "updated",
      aliases: ["modified"],
      meta: meta(t(($) => $.library.home.search.sorts.updatedDesc)),
      ascendingMeta: meta(t(($) => $.library.home.search.sorts.updatedAsc)),
      compare: (a, b) => projectUpdatedAt(a, state.modified) - projectUpdatedAt(b, state.modified),
    },
    {
      value: "created",
      meta: meta(t(($) => $.library.home.search.sorts.createdDesc)),
      ascendingMeta: meta(t(($) => $.library.home.search.sorts.createdAsc)),
      compare: (a, b) => a.created_at - b.created_at,
    },
    {
      value: "opened",
      meta: meta(t(($) => $.library.home.search.sorts.openedDesc)),
      ascendingMeta: meta(t(($) => $.library.home.search.sorts.openedAsc)),
      compare: (a, b) => at(a.last_opened_at) - at(b.last_opened_at),
    },
    {
      value: "name",
      aliases: ["title"],
      meta: meta(t(($) => $.library.home.search.sorts.nameDesc)),
      ascendingMeta: meta(t(($) => $.library.home.search.sorts.nameAsc)),
      compare: (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }),
    },
  ];
}

export function buildProjectSearchSchema(
  t: Translate,
  state: ProjectSearchState,
  extensions: readonly ProjectSearchExtension[] = [],
): SearchSchema<ProjectInfo, QueryMeta> {
  const has = flagField<ProjectInfo, QueryMeta>(
    "has",
    [...hasFlags(t), ...extensions.flatMap((extension) => extension.has ?? [])],
    { meta: { label: t(($) => $.library.home.search.fields.has), icon: icon(CircleCheck) } },
  );
  return defineSchema<ProjectInfo, QueryMeta>({
    fields: [
      flagField<ProjectInfo, QueryMeta>(
        "is",
        [...isFlags(t, state), ...extensions.flatMap((extension) => extension.is ?? [])],
        { meta: { label: t(($) => $.library.home.search.fields.is), icon: icon(CircleDot) } },
      ),
      has,
      absenceField("no", has, { meta: { label: t(($) => $.library.home.search.fields.no), icon: icon(CircleOff) } }),
      ...valueFields(t, state),
      ...extensions.flatMap((extension) => extension.fields ?? []),
    ],
    text: [...textScopes(t, state), ...extensions.flatMap((extension) => extension.text ?? [])],
    textMeta: { label: t(($) => $.library.home.search.fields.in), icon: icon(TextSearch) },
    sorts: [...sortOrders(t, state), ...extensions.flatMap((extension) => extension.sorts ?? [])],
    sortMeta: { label: t(($) => $.library.home.search.fields.sort), icon: icon(ArrowDownUp) },
    defaultSort: DEFAULT_PROJECT_SORT,
  });
}

function single(id: string, key: string, value: string, negated = false) {
  return { id, term: { key, values: [value], negated } };
}

const RECENT = [
  single("7", "created", ">@today-1w"),
  single("30", "created", ">@today-30d"),
  single("365", "created", ">@today-1y"),
];

export const PROJECT_FACETS = {
  location: {
    keys: ["is"],
    values: ["library", "folder"],
    options: [single("library", "is", "library"), single("external", "is", "folder")],
  },
  engine: { keys: ["engine"], options: PROJECT_ENGINES.map((engine) => single(engine, "engine", engine)) },
  kind: { keys: ["kind"], options: PROJECT_KINDS.map((kind) => single(kind, "kind", kind)) },
  bookmark: {
    keys: ["is"],
    values: ["bookmarked"],
    options: [single("yes", "is", "bookmarked"), single("no", "is", "bookmarked", true)],
  },
  preview: {
    keys: ["has", "no"],
    values: ["preview"],
    options: [single("yes", "has", "preview"), single("no", "no", "preview")],
  },
  created: { keys: ["created"], options: RECENT },
  modified: {
    keys: ["updated"],
    options: RECENT.map((option) => ({ ...option, term: { ...option.term, key: "updated" } })),
  },
  sort: {
    keys: ["sort"],
    options: ["activity", "updated", "created", "opened", "name"].flatMap((order) =>
      ["desc", "asc"].map((direction) => single(`${order}-${direction}`, "sort", `${order}-${direction}`)),
    ),
  },
} as const satisfies Record<string, Facet>;

export type ProjectFacet = keyof typeof PROJECT_FACETS;
