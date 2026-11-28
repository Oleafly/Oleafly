import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Command, useCommandState } from "cmdk";
import { Braces } from "lucide-react";
import type { SnippetLanguage, SnippetRecord } from "@oleafly/snippets";
import { Button } from "@/components/ui/button";
import { CodeBlock } from "@/components/ui/code-block";
import { COMMAND_GROUP, COMMAND_ITEM } from "@/components/ui/command-dialog";
import { insertSnippetAtCursor } from "./insert-at-cursor";
import { renderSnippetMath } from "./math-preview";
import { openSnippetSettings } from "./open-settings";
import {
  collectionName,
  expandLabel,
  isMathPlace,
  placeLabel,
  searchTerms,
  snippetFits,
  snippetMatchesTerms,
  snippetMathSource,
  snippetName,
  snippetSource,
  snippetText,
} from "./records";
import { useSnippetStore } from "./store";

const VALUE_PREFIX = "snippet:";

interface SnippetPaletteGroup {
  collection: string;
  name: string;
  records: SnippetRecord[];
}

export interface SnippetPaletteList {
  groups: SnippetPaletteGroup[];
  shown: number;
  total: number;
}

function snippetValue(record: SnippetRecord): string {
  return `${VALUE_PREFIX}${record.collection}\u0000${record.id}`;
}

function byLanguage(language: SnippetLanguage | null) {
  return (a: SnippetRecord, b: SnippetRecord) => Number(snippetFits(b, language)) - Number(snippetFits(a, language));
}

function useSnippetPalette(term: string, language: SnippetLanguage | null): SnippetPaletteList {
  const library = useSnippetStore((store) => store.library);
  const files = useSnippetStore((store) => store.files);
  useEffect(() => {
    void useSnippetStore.getState().load();
  }, []);
  return useMemo(() => {
    const groups = new Map<string, SnippetPaletteGroup>();
    const terms = searchTerms(term);
    const lowered = term.toLowerCase();
    for (const record of library.records) {
      const name = collectionName(record.collection, files);
      if (!snippetMatchesTerms(record, terms) && !(term && name.toLowerCase().includes(lowered))) continue;
      const group = groups.get(record.collection);
      if (group) group.records.push(record);
      else groups.set(record.collection, { collection: record.collection, name, records: [record] });
    }
    const order = byLanguage(language);
    const sorted = [...groups.values()]
      .map((group) => ({ ...group, records: [...group.records].sort(order) }))
      .sort((a, b) => order(a.records[0], b.records[0]));
    return {
      groups: sorted,
      shown: sorted.reduce((count, group) => count + group.records.length, 0),
      total: library.records.length,
    };
  }, [library, files, term, language]);
}

export function SnippetPaletteGroups({
  term,
  language,
  onList,
  onInsert,
}: Readonly<{
  term: string;
  language: SnippetLanguage | null;
  onList: (list: SnippetPaletteList | null) => void;
  onInsert: (insert: () => void) => void;
}>) {
  const { t } = useTranslation(["shell"]);
  const list = useSnippetPalette(term, language);
  useLayoutEffect(() => onList(list), [onList, list]);
  useLayoutEffect(() => () => onList(null), [onList]);
  if (list.groups.length === 0) {
    return <div className="px-3 py-6 text-center text-sm text-muted-foreground">{t(($) => $.shell.snippets.palette.noMatches)}</div>;
  }
  return list.groups.map((group) => (
    <Command.Group key={group.collection} heading={group.name} className={COMMAND_GROUP}>
      {group.records.map((record) => (
        <Command.Item key={snippetValue(record)} value={snippetValue(record)} onSelect={() => onInsert(() => insertSnippetAtCursor(record.id))} className={COMMAND_ITEM}>
          <Braces aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 truncate">{snippetName(record)}</span>
          {record.trigger !== null && record.regex === null ? (
            <code className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{record.trigger}</code>
          ) : null}
          <span className="ml-auto shrink-0 text-xs text-muted-foreground">{expandLabel(record.expand)}</span>
        </Command.Item>
      ))}
    </Command.Group>
  ));
}

function MathPreview({ source, language }: Readonly<{ source: string; language: SnippetLanguage }>) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = renderSnippetMath(source, language);
    if (!element || !host.current) return;
    host.current.replaceChildren(element);
  }, [source, language]);
  return <div ref={host} data-testid="snippet-preview-math" className="rounded-md border bg-background p-2" />;
}

export function SnippetPalettePreview({
  list,
  language,
  onClose,
}: Readonly<{ list: SnippetPaletteList; language: SnippetLanguage | null; onClose: () => void }>) {
  const { t } = useTranslation(["shell"]);
  const value = useCommandState((state) => state.value);
  const files = useSnippetStore((store) => store.files);
  const record = useMemo(
    () => list.groups.flatMap((group) => group.records).find((candidate) => snippetValue(candidate) === value) ?? null,
    [list, value],
  );
  if (!record) return null;
  const bodyLanguage = snippetFits(record, language) || record.languages === "any" ? language : record.languages[0];
  const learnable = record.trigger !== null && record.regex === null;
  return (
    <aside
      data-testid="snippet-preview"
      aria-label={snippetName(record)}
      className="hidden w-64 shrink-0 space-y-2 overflow-auto border-l p-3 text-xs sm:block"
    >
      <div>
        <div className="text-sm font-medium">{snippetName(record)}</div>
        <div className="text-muted-foreground">
          {t(($) => $.shell.snippets.palette.summary, {
            collection: collectionName(record.collection, files),
            where: placeLabel(record.place),
            expands: expandLabel(record.expand),
          })}
        </div>
      </div>
      <CodeBlock code={snippetText(record, bodyLanguage)} preClassName="max-h-40 p-2 pr-9 text-[0.6875rem]">
        {snippetSource(record, bodyLanguage)}
      </CodeBlock>
      {isMathPlace(record.place) && bodyLanguage ? <MathPreview source={snippetMathSource(record, bodyLanguage)} language={bodyLanguage} /> : null}
      {learnable ? (
        <p className="text-muted-foreground">
          {t(($) => $.shell.snippets.palette.learn, { trigger: record.trigger })}
        </p>
      ) : null}
      <div className="flex justify-end">
        <Button
          type="button"
          variant="ghost"
          size="xs"
          onClick={() => {
            onClose();
            openSnippetSettings(record.id);
          }}
        >
          {t(($) => $.shell.snippets.palette.edit)}
        </Button>
      </div>
    </aside>
  );
}
