import { useDeferredValue, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { renderLatexOutlineTitle } from "@oleafly/latex";
import { Badge } from "@/components/ui/badge";
import { SearchField } from "@/components/ui/search-field";
import { ROW_WINDOW_ITEM, useRowWindow } from "@/hooks/use-row-window";
import { i18n } from "@/i18n";
import { formatList } from "@/lib/intl";
import { parseBib } from "@/lib/latex-tools";
import { useFilesStore } from "@/store/files";

export interface BibRow {
  readonly key: string;
  readonly type: string;
  readonly title: string;
  readonly authors: string;
  readonly year: string;
  readonly venue: string;
  readonly from: number;
}

const NOT_REFERENCES = new Set(["string", "preamble", "comment"]);
const ENTRY_HEAD = /@\s*([A-Za-z]+)\s*[{(]\s*([^,\s{}()]+)\s*,/gu;

function plain(value: string | undefined): string {
  return value ? renderLatexOutlineTitle(value).replace(/\s+/gu, " ").trim() : "";
}

function surname(name: string): string {
  const comma = name.indexOf(",");
  if (comma >= 0) return name.slice(0, comma).trim();
  return name.trim().split(/\s+/u).at(-1) ?? "";
}

export function authorLine(field: string | undefined): string {
  const names = plain(field)
    .split(/\s+and\s+/iu)
    .map(surname)
    .filter(Boolean);
  if (names.length > 2) return i18n.t(($) => $.editor.bibList.etAl, { author: names[0] });
  return formatList(names);
}

export function bibRows(text: string): BibRow[] {
  const offsets = new Map<string, number>();
  for (const match of text.matchAll(ENTRY_HEAD)) {
    if (!offsets.has(match[2])) offsets.set(match[2], match.index);
  }
  return parseBib(text)
    .entries.filter((entry) => !NOT_REFERENCES.has(entry.type.toLowerCase()))
    .map(({ key, type, fields }) => ({
      key,
      type: type.toLowerCase(),
      title: plain(fields.title),
      authors: authorLine(fields.author ?? fields.editor),
      year: plain(fields.year ?? fields.date?.slice(0, 4)),
      venue: plain(fields.journal ?? fields.booktitle ?? fields.publisher ?? fields.school ?? fields.howpublished),
      from: offsets.get(key) ?? 0,
    }));
}

function matches(row: BibRow, query: string): boolean {
  if (!query) return true;
  return [row.key, row.title, row.authors, row.year, row.venue].some((part) => part.toLowerCase().includes(query));
}

export function BibReferenceList({ path, onReveal }: Readonly<{ path: string; onReveal: (from: number) => void }>) {
  const { t } = useTranslation(["editor"]);
  const content = useFilesStore((state) => state.files[path]?.content ?? "");
  const rows = useMemo(() => bibRows(content), [content]);
  const [search, setSearch] = useState("");
  const query = useDeferredValue(search.trim().toLowerCase());
  const shown = useMemo(() => rows.filter((row) => matches(row, query)), [rows, query]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const window = useRowWindow({ count: shown.length, scrollRef, listRef });

  return (
    <div data-testid="bib-reference-list" className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex shrink-0 items-center gap-3 border-b px-3 py-2">
        <SearchField
          value={search}
          onChange={setSearch}
          label={t(($) => $.editor.bibList.search)}
          placeholder={t(($) => $.editor.bibList.search)}
          clearOnEscape
          className="max-w-sm flex-1"
        />
        <output className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums">
          {t(($) => $.editor.bibList.count, { count: rows.length })}
        </output>
      </div>
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        {shown.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">
            {rows.length === 0 ? t(($) => $.editor.bibList.empty) : t(($) => $.editor.bibList.noMatch)}
          </p>
        ) : (
          <div ref={listRef} style={{ paddingTop: window.paddingTop, paddingBottom: window.paddingBottom }}>
            {shown.slice(window.start, window.end).map((row) => (
              <button
                key={row.key}
                type="button"
                {...{ [ROW_WINDOW_ITEM]: "" }}
                onClick={() => onReveal(row.from)}
                className="flex h-14 w-full min-w-0 flex-col justify-center gap-0.5 border-b px-4 text-left transition-colors hover:bg-accent focus-visible:bg-accent"
              >
                <span className="flex w-full min-w-0 items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{row.title || row.key}</span>
                  <Badge variant="muted" size="sm" className="shrink-0 font-mono">
                    {row.key}
                  </Badge>
                </span>
                <span className="w-full truncate text-xs text-muted-foreground">
                  {[row.authors, row.year, row.venue].filter(Boolean).join(" · ")}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
