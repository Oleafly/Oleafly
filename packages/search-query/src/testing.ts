import { analyze } from "./analyze";
import { runQuery } from "./evaluate";
import { absenceField, defineSchema, flagField, type SearchContext } from "./schema";

export interface Doc {
  readonly id: string;
  readonly title: string;
  readonly engine: "tectonic" | "typst" | "markdown";
  readonly tags: readonly string[];
  readonly starred: boolean;
  readonly pages: number;
  readonly created: number;
  readonly preview: boolean;
}

export const NOW = new Date(2026, 9, 2, 12).getTime();
const DAY = 86_400_000;

export const DOCS: readonly Doc[] = [
  { id: "a", title: "Thesis draft", engine: "tectonic", tags: ["phd", "draft"], starred: true, pages: 120, created: NOW - 2 * DAY, preview: true },
  { id: "b", title: "Lab notes", engine: "markdown", tags: ["notes"], starred: false, pages: 4, created: NOW - 40 * DAY, preview: false },
  { id: "c", title: "Conference poster", engine: "typst", tags: ["poster", "draft"], starred: false, pages: 1, created: NOW - 400 * DAY, preview: true },
  { id: "d", title: "Résumé", engine: "typst", tags: [], starred: true, pages: 2, created: NOW - 10 * DAY, preview: false },
];

const has = flagField<Doc>("has", [
  { value: "preview", aliases: ["pdf"], test: (doc) => doc.preview },
  { value: "tags", test: (doc) => doc.tags.length > 0 },
]);

export const schema = defineSchema<Doc>({
  fields: [
    {
      key: "engine",
      type: "enum",
      options: [
        { value: "tectonic", aliases: ["latex", "tex"] },
        { value: "typst" },
        { value: "markdown", aliases: ["md"] },
      ],
      test: (doc, value) => doc.engine === value,
    },
    { key: "tag", aliases: ["label"], type: "text", test: (doc, needle) => doc.tags.includes(needle) },
    flagField<Doc>("is", [{ value: "starred", aliases: ["favorite"], test: (doc) => doc.starred }]),
    has,
    absenceField("no", has),
    { key: "pages", type: "number", get: (doc) => doc.pages },
    { key: "created", type: "date", get: (doc) => doc.created },
  ],
  text: [
    { value: "title", get: (doc) => doc.title },
    { value: "id", get: (doc) => doc.id },
    { value: "pages", hidden: true, get: (doc) => `${doc.pages} pages` },
  ],
  sorts: [
    { value: "created", compare: (a, b) => a.created - b.created },
    { value: "title", aliases: ["name"], compare: (a, b) => a.title.localeCompare(b.title) },
  ],
  defaultSort: "created-desc",
});

export const context: SearchContext = { now: NOW };

export function query(source: string) {
  return analyze(source, schema, context);
}

export function ids(source: string): string {
  return runQuery(DOCS, query(source), schema, context)
    .map((doc) => doc.id)
    .join("");
}
