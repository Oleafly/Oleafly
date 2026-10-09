import { useDeferredValue, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { BookmarkPlus, Search, Tag } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Popover, PopoverItem } from "@/components/ui/popover";
import { addTypstLabel, insertTypstReferenceTo } from "@/components/editor/typst-commands";
import { parseTypstFile } from "@/lib/index/parse-typst";
import type { Sym } from "@/lib/index/types";
import { useFilesStore } from "@/store/files";
import { useIndexStore } from "@/store/project-index";

const TYPST_FILE = /\.typ$/iu;
const MAX_LABELS = 200;

export interface TypstLabelEntry {
  readonly name: string;
  readonly file: string;
  readonly line: number;
}

export function collectTypstLabels(
  defs: readonly Sym[],
  activePath: string | null,
  activeText: string,
  query: string,
): TypstLabelEntry[] {
  const seen = new Set<string>();
  const entries: TypstLabelEntry[] = [];
  const add = (definition: Sym) => {
    if (definition.kind !== "label" || seen.has(definition.name)) return;
    seen.add(definition.name);
    entries.push({ name: definition.name, file: definition.file, line: definition.line });
  };
  if (activePath && TYPST_FILE.test(activePath)) {
    for (const definition of parseTypstFile(activePath, activeText).defs) add(definition);
  }
  const others = defs
    .filter((definition) => TYPST_FILE.test(definition.file) && definition.file !== activePath)
    .sort((left, right) => left.file.localeCompare(right.file) || left.line - right.line);
  for (const definition of others) add(definition);
  const needle = query.trim().toLowerCase();
  return entries
    .filter((entry) => needle === "" || entry.name.toLowerCase().includes(needle))
    .slice(0, MAX_LABELS);
}

function LabelList({ query }: Readonly<{ query: string }>) {
  const { t } = useTranslation(["common", "editor"]);
  const defs = useIndexStore((state) => state.index?.defs);
  const activePath = useFilesStore((state) => state.activePath);
  const activeText = useFilesStore((state) =>
    state.activePath ? state.files[state.activePath]?.content ?? "" : "",
  );
  const labels = useMemo(
    () => collectTypstLabels(defs ?? [], activePath, activeText, query),
    [defs, activePath, activeText, query],
  );
  if (labels.length === 0) {
    return (
      <div className="px-2 py-4 text-center text-xs text-muted-foreground">
        {query.trim() ? t(($) => $.editor.labels.noMatches) : t(($) => $.editor.labels.empty)}
      </div>
    );
  }
  return labels.map((label) => (
    <PopoverItem key={`${label.file}:${label.name}`} onClick={() => void insertTypstReferenceTo(label.name)}>
      <span className="grid min-w-0 flex-1 gap-y-0.5 py-0.5">
        <span className="truncate font-mono text-xs">{label.name}</span>
        <span className="truncate text-[0.625rem] text-muted-foreground">
          {t(($) => $.editor.labels.location, { file: label.file, line: label.line })}
        </span>
      </span>
    </PopoverItem>
  ));
}

export function TypstLabelPicker({ variant }: Readonly<{ variant: "bar" | "menu" }>) {
  const { t } = useTranslation(["common", "editor"]);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  return (
    <Popover
      ariaLabel={t(($) => $.editor.toolbar.insertCrossReference)}
      closeOnClick={false}
      className="w-[20rem] max-w-[calc(100vw-2rem)] overflow-hidden p-0"
      triggerClassName={variant === "menu" ? "w-full justify-start gap-2 px-2 font-normal" : undefined}
      trigger={
        variant === "bar" ? (
          <Tag className="size-4" />
        ) : (
          <>
            <Tag className="size-4" />
            <span className="flex-1 text-left">{t(($) => $.editor.toolbar.insertCrossReference)}</span>
          </>
        )
      }
    >
      <div className="flex items-center gap-2 border-b px-2.5 py-2">
        <Search className="size-3.5 shrink-0 text-muted-foreground" />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t(($) => $.editor.labels.filterPlaceholder)}
          aria-label={t(($) => $.editor.labels.filterLabel)}
          className="h-7 border-0 bg-transparent px-0 text-xs shadow-none"
        />
      </div>
      <div className="max-h-72 overflow-y-auto p-1">
        <LabelList query={deferredQuery} />
      </div>
      <div className="border-t p-1">
        <PopoverItem onClick={() => void addTypstLabel()}>
          <BookmarkPlus className="size-3.5 text-muted-foreground" />
          <span>{t(($) => $.editor.labels.addHere)}</span>
        </PopoverItem>
      </div>
    </Popover>
  );
}
