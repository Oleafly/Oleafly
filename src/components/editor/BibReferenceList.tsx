import { BookOpen, SearchX } from "lucide-react";
import { useDeferredValue, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { renderLatexOutlineTitle } from "@oleafly/latex";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyMedia, EmptyState } from "@/components/ui/empty";
import { SearchField } from "@/components/ui/search-field";
import { ROW_WINDOW_ITEM, useRowWindow } from "@/hooks/use-row-window";
import { i18n } from "@/i18n";
import { andSeparator, commaSeparator, splitFirstVonLast, splitTopLevel } from "@/lib/citation/bibtex-names";
import { formatList, formatNumber } from "@/lib/intl";
import { parseBib } from "@/lib/latex-tools";
import { cn } from "@/lib/utils";
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

interface BibListView {
  readonly search: string;
  readonly selected: string | null;
}

const NOT_REFERENCES = new Set(["string", "preamble", "comment"]);
const ENTRY_HEAD = /@\s*([A-Za-z]+)\s*[{(]\s*([^,\s{}()]+)\s*,/gu;
const NO_VIEW: BibListView = { search: "", selected: null };
const views = new Map<string, BibListView>();

function plain(value: string | undefined): string {
  return value ? renderLatexOutlineTitle(value).replace(/\s+/gu, " ").trim() : "";
}

function surname(name: string): string {
  const parts = splitTopLevel(name, commaSeparator).filter(Boolean);
  if (parts.length > 1) return parts[0];
  return splitFirstVonLast(parts[0] ?? "").family;
}

export function authorLine(field: string | undefined): string {
  const names = splitTopLevel(field ?? "", andSeparator).filter(Boolean);
  const others = names.length > 1 && names.at(-1)?.toLowerCase() === "others";
  const surnames = (others ? names.slice(0, -1) : names).map((name) => plain(surname(name))).filter(Boolean);
  if (surnames.length === 0) return "";
  if (others || surnames.length > 2) return i18n.t(($) => $.editor.bibList.etAl, { author: surnames[0] });
  return formatList(surnames);
}

function entryOffsets(text: string): Map<string, number[]> {
  const offsets = new Map<string, number[]>();
  for (const match of text.matchAll(ENTRY_HEAD)) {
    const known = offsets.get(match[2]);
    if (known) known.push(match.index);
    else offsets.set(match[2], [match.index]);
  }
  return offsets;
}

export function bibRows(text: string): BibRow[] {
  const offsets = entryOffsets(text);
  return parseBib(text)
    .entries.filter((entry) => !NOT_REFERENCES.has(entry.type.toLowerCase()))
    .map(({ key, type, fields }) => ({
      key,
      type: type.toLowerCase(),
      title: plain(fields.title),
      authors: authorLine(fields.author ?? fields.editor),
      year: plain(fields.year ?? fields.date?.slice(0, 4)),
      venue: plain(fields.journal ?? fields.booktitle ?? fields.publisher ?? fields.school ?? fields.howpublished),
      from: offsets.get(key)?.shift() ?? 0,
    }));
}

function matches(row: BibRow, query: string): boolean {
  if (!query) return true;
  return [row.key, row.title, row.authors, row.year, row.venue].some((part) => part.toLowerCase().includes(query));
}

export function BibReferenceList({ path, onReveal }: Readonly<{ path: string; onReveal: (from: number) => void }>) {
  const projectId = useFilesStore((state) => state.projectId);
  const viewKey = `${projectId ?? ""}\n${path}`;
  return <BibList key={viewKey} viewKey={viewKey} path={path} onReveal={onReveal} />;
}

function BibList({
  viewKey,
  path,
  onReveal,
}: Readonly<{ viewKey: string; path: string; onReveal: (from: number) => void }>) {
  const { t } = useTranslation(["editor"]);
  const content = useDeferredValue(useFilesStore((state) => state.files[path]?.content ?? ""));
  const rows = useMemo(() => bibRows(content), [content]);
  const [view, setView] = useState(() => views.get(viewKey) ?? NO_VIEW);
  const query = useDeferredValue(view.search.trim().toLowerCase());
  const shown = useMemo(() => rows.filter((row) => matches(row, query)), [rows, query]);
  const searchRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const rowWindow = useRowWindow({ count: shown.length, scrollRef, listRef });
  const { rowHeight, scrollToIndex } = rowWindow;
  const selectedIndex = view.selected === null ? -1 : shown.findIndex((row) => row.key === view.selected);
  const revealedFor = useRef<string | null>(null);

  useLayoutEffect(() => {
    if (selectedIndex < 0) {
      revealedFor.current = null;
      return;
    }
    if (rowHeight <= 0 || revealedFor.current === query) return;
    revealedFor.current = query;
    scrollToIndex(selectedIndex);
  }, [query, rowHeight, scrollToIndex, selectedIndex]);

  const remember = (next: BibListView) => {
    views.set(viewKey, next);
    setView(next);
  };
  const pick = (row: BibRow) => {
    remember({ ...view, selected: row.key });
    onReveal(row.from);
  };
  const clearSearch = () => {
    remember({ ...view, search: "" });
    searchRef.current?.focus();
  };

  const total = rows.length;
  const count =
    shown.length === total
      ? t(($) => $.editor.bibList.count, { count: total })
      : t(($) => $.editor.bibList.matchCount, {
          count: total,
          shown: formatNumber(shown.length),
          total: formatNumber(total),
        });

  const renderEmpty = () =>
    total === 0 ? (
      <EmptyState
        icon={
          <EmptyMedia>
            <BookOpen aria-hidden className="size-6" />
          </EmptyMedia>
        }
        description={t(($) => $.editor.bibList.empty)}
        className="min-h-full px-6 py-10"
      />
    ) : (
      <EmptyState
        icon={
          <EmptyMedia variant="icon">
            <SearchX aria-hidden className="size-6" />
          </EmptyMedia>
        }
        description={t(($) => $.editor.bibList.noMatch)}
        className="min-h-full px-6 py-10"
      >
        <Button variant="outline" size="sm" onClick={clearSearch}>
          {t(($) => $.editor.bibList.clearSearch)}
        </Button>
      </EmptyState>
    );

  return (
    <div data-testid="bib-reference-list" className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex shrink-0 items-center gap-3 border-b px-3 py-2">
        <SearchField
          value={view.search}
          onChange={(search) => remember({ ...view, search })}
          label={t(($) => $.editor.bibList.search)}
          placeholder={t(($) => $.editor.bibList.search)}
          clearLabel={t(($) => $.editor.bibList.clearSearch)}
          inputRef={searchRef}
          clearOnEscape
          className="max-w-sm flex-1"
        />
        <output className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums">{count}</output>
      </div>
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        {shown.length === 0 ? (
          renderEmpty()
        ) : (
          <div ref={listRef} style={{ paddingTop: rowWindow.paddingTop, paddingBottom: rowWindow.paddingBottom }}>
            {shown.slice(rowWindow.start, rowWindow.end).map((row) => {
              const selected = row.key === view.selected;
              return (
                <button
                  key={`${row.key}\n${row.from}`}
                  type="button"
                  {...{ [ROW_WINDOW_ITEM]: "" }}
                  aria-current={selected ? "true" : undefined}
                  onClick={() => pick(row)}
                  className={cn(
                    "flex h-14 w-full min-w-0 flex-col justify-center gap-0.5 border-b px-4 text-left transition-colors motion-reduce:transition-none",
                    selected
                      ? "bg-primary/10 hover:bg-primary/15 focus-visible:bg-primary/15"
                      : "hover:bg-accent focus-visible:bg-accent",
                  )}
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
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
