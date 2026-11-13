import { CalendarDays, Code2, FileSearch, Heading, LayoutTemplate, List, Pilcrow, Quote, Settings, Table2, Waypoints, X } from "lucide-react";
import { type ComponentProps, type ReactNode, useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { normalizeText } from "@oleafly/search-query";
import { ThemeToggleButton } from "@/components/layout/ThemeControls";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty";
import { SearchField } from "@/components/ui/search-field";
import { Tooltip } from "@/components/ui/tooltip";
import { TooltipIconButton } from "@/components/ui/tooltip-icon-button";
import type { NoteBlockHit, NoteSearchHit } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import { isSelectionModifier } from "@/store/library-selection";
import { shortcutLabel, type ShortcutId, useShortcutStore } from "@/store/shortcuts";
import { NoteChip } from "./note-icons";
import type { TagNode } from "./note-search";
import { tagTone } from "./note-tags";
import { Highlighted } from "@/components/ui/highlighted";
import { VaultMoreMenu, type VaultMoreMenuProps } from "./NoteImportDialog";
import { NoteListItem } from "./NoteListItem";
import type { NoteItem } from "./types";
import { NoteSnippet } from "./NoteSnippet";

export interface SearchRow {
  hit: NoteSearchHit;
  note: NoteItem;
  block?: NoteBlockHit;
  more?: number;
}

const BLOCK_ICONS = { paragraph: Pilcrow, item: List, row: Table2, heading: Heading, quote: Quote, code: Code2 } as const;

function rowKey(row: SearchRow): string {
  if (row.block) return `${row.hit.id}:block:${row.block.line}`;
  return row.more === undefined ? row.hit.id : `${row.hit.id}:more`;
}

function SubRow({
  id,
  selected,
  onHover,
  onChoose,
  icon,
  children,
  ...data
}: Readonly<{
  id: string;
  selected: boolean;
  onHover: () => void;
  onChoose: (newTab: boolean) => void;
  icon?: ReactNode;
  children: ReactNode;
  [key: `data-${string}`]: string | number | undefined;
}>) {
  return (
    <button
      type="button"
      id={id}
      role="option"
      tabIndex={-1}
      aria-selected={selected}
      {...data}
      onMouseMove={onHover}
      onMouseDown={(event) => event.preventDefault()}
      onClick={(event) => onChoose(isSelectionModifier(event))}
      className={cn(
        "flex w-full items-start gap-2 rounded-md py-1 pr-2 pl-9 text-left text-xs text-muted-foreground transition-colors hover:bg-accent motion-reduce:transition-none",
        selected && "bg-accent",
      )}
    >
      {icon}
      <span className="-my-0.5 line-clamp-2 min-w-0 flex-1 py-0.5">{children}</span>
    </button>
  );
}

export function optionId(listId: string, index: number): string {
  return `${listId}-option-${index}`;
}

export function SearchResultList({
  listId,
  label,
  rows,
  active,
  activeNoteId,
  onActiveChange,
  onOpen,
}: Readonly<{
  listId: string;
  label: string;
  rows: readonly SearchRow[];
  active: number;
  activeNoteId: string | null;
  onActiveChange: (index: number) => void;
  onOpen: (row: SearchRow, newTab: boolean) => void;
}>) {
  const { t } = useTranslation(["notes"]);
  return (
    <div id={listId} role="listbox" aria-label={label} className="space-y-0.5">
      {rows.map((row, index) => {
        const { hit, note, block, more } = row;
        const hover = () => {
          if (index !== active) onActiveChange(index);
        };
        if (block || more !== undefined) {
          const Icon = block ? BLOCK_ICONS[block.kind] : null;
          return (
            <SubRow
              key={rowKey(row)}
              id={optionId(listId, index)}
              selected={index === active}
              onHover={hover}
              onChoose={(newTab) => onOpen(row, newTab)}
              data-search-block={block ? block.line : undefined}
              data-search-more={more}
              icon={Icon ? <Icon aria-hidden className="mt-0.5 size-3.5 shrink-0" /> : undefined}
            >
              {block ? <NoteSnippet text={block.text} ranges={block.ranges} /> : t(($) => $.notes.linksSearch.tagBlocks.more, { count: more ?? 0 })}
            </SubRow>
          );
        }
        const snippet = hit.blocks?.length ? undefined : hit.snippets[0];
        return (
          <NoteListItem
            key={rowKey(row)}
            id={optionId(listId, index)}
            role="option"
            tabIndex={-1}
            aria-selected={index === active}
            data-search-hit={hit.id}
            active={activeNoteId === hit.id}
            className={index === active ? "bg-accent" : undefined}
            icon={<NoteChip icon={note.icon} color={note.color} />}
            title={<Highlighted text={hit.title} ranges={hit.titleRanges} />}
            snippet={snippet ? <NoteSnippet text={snippet.text} ranges={snippet.ranges} /> : undefined}
            onMouseMove={hover}
            onMouseDown={(event) => event.preventDefault()}
            onClick={(event) => onOpen(row, isSelectionModifier(event))}
          />
        );
      })}
    </div>
  );
}

const TAGS_SHOWN = 30;

interface TagEntry {
  tag: string;
  label: string;
  count: number;
}

function tagEntries(tree: readonly TagNode[], parent = ""): TagEntry[] {
  return tree.flatMap((node) => {
    const label = parent ? `${parent}/${node.name}` : node.name;
    return [{ tag: node.tag, label, count: node.count }, ...tagEntries(node.children, label)];
  });
}

function matchTags(entries: readonly TagEntry[], query: string): readonly TagEntry[] {
  const wanted = normalizeText(query.trim().replace(/^#+/u, ""));
  if (!wanted) return entries;
  return entries.filter((entry) => normalizeText(entry.label).includes(wanted) || normalizeText(entry.tag).includes(wanted));
}

function TagBadge({ entry, pressed, onToggle }: Readonly<{ entry: TagEntry; pressed: boolean; onToggle: () => void }>) {
  const { t } = useTranslation(["notes"]);
  const [clipped, setClipped] = useState(false);
  const watchName = useCallback((name: HTMLSpanElement | null) => {
    if (!name) return;
    const measure = () => setClipped(name.scrollWidth > name.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(name);
    return () => observer.disconnect();
  }, []);
  const tone = tagTone(entry.tag);
  const badge = (
    <Badge
      asChild
      variant="muted"
      className={cn("max-w-full gap-1 transition-colors motion-reduce:transition-none aria-pressed:border-current", tone.tint, tone.text, tone.hover)}
    >
      <button type="button" aria-pressed={pressed} aria-label={t(($) => $.notes.vault.tags.filter, { tag: entry.tag })} onClick={onToggle}>
        <span ref={watchName} className="min-w-0 truncate">
          #{entry.label}
        </span>
        <span className="font-mono text-[0.625rem] tabular-nums opacity-70">{entry.count}</span>
      </button>
    </Badge>
  );
  if (!clipped) return badge;
  return (
    <Tooltip label={`#${entry.label}`} className="min-w-0 max-w-full">
      {badge}
    </Tooltip>
  );
}

export function TagPane({
  tree,
  selected,
  onSelect,
}: Readonly<{ tree: readonly TagNode[] | null; selected: string | null; onSelect: (tag: string | null) => void }>) {
  const { t } = useTranslation(["notes"]);
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);
  const entries = useMemo(() => (tree ? tagEntries(tree) : []), [tree]);
  const matches = useMemo(() => matchTags(entries, query), [entries, query]);
  if (tree === null) return null;
  if (entries.length === 0) return <EmptyState size="compact" description={t(($) => $.notes.vault.tags.empty)} className="items-start" />;
  const cut = showAll ? matches : matches.slice(0, TAGS_SHOWN);
  const hiddenPick = cut.some((entry) => entry.tag === selected) ? undefined : matches.find((entry) => entry.tag === selected);
  const shown = hiddenPick ? [...cut, hiddenPick] : cut;
  return (
    <div className="space-y-2">
      <SearchField
        value={query}
        onChange={setQuery}
        label={t(($) => $.notes.vault.tags.search)}
        placeholder={t(($) => $.notes.vault.tags.search)}
        clearLabel={t(($) => $.notes.vault.search.clear)}
        clearOnEscape
      />
      {matches.length === 0 ? (
        <output className="block">
          <EmptyState size="compact" description={t(($) => $.notes.vault.tags.noMatch, { query: query.trim() })} className="items-start" />
        </output>
      ) : (
        <ul aria-label={t(($) => $.notes.vault.tags.label)} className="flex max-h-72 flex-wrap gap-1 overflow-y-auto">
          {shown.map((entry) => (
            <li key={entry.tag} className="flex min-w-0 max-w-full">
              <TagBadge entry={entry} pressed={entry.tag === selected} onToggle={() => onSelect(entry.tag === selected ? null : entry.tag)} />
            </li>
          ))}
        </ul>
      )}
      {matches.length > TAGS_SHOWN && (
        <Button variant="link" size="xs" className="h-auto px-0" aria-expanded={showAll} onClick={() => setShowAll(!showAll)}>
          {showAll ? t(($) => $.notes.vault.tags.showFewer) : t(($) => $.notes.vault.tags.showAll, { total: matches.length })}
        </Button>
      )}
    </div>
  );
}

export function TagChip({ tag, onClear }: Readonly<{ tag: string; onClear: () => void }>) {
  const { t } = useTranslation(["notes"]);
  const tone = tagTone(tag);
  return (
    <Badge asChild variant="muted" size="sm" className={cn("max-w-full gap-1 pr-1", tone.tint, tone.text, tone.hover)}>
      <button type="button" onClick={onClear} aria-label={t(($) => $.notes.vault.tags.clear, { tag })}>
        <span className="truncate">#{tag}</span>
        <X aria-hidden className="size-3 shrink-0" />
      </button>
    </Badge>
  );
}

export function ShortcutButton({
  label,
  shortcut,
  ...props
}: Readonly<{ label: string; shortcut: ShortcutId } & Omit<ComponentProps<typeof TooltipIconButton>, "label" | "tooltip">>) {
  const { t } = useTranslation(["shell"]);
  const keys = useShortcutStore((state) => shortcutLabel(state.bindings[shortcut]));
  return (
    <TooltipIconButton
      label={label}
      tooltip={t(($) => $.shell.rail.withShortcut, { label, shortcut: keys })}
      disabled={!props.onClick}
      {...props}
    />
  );
}

const FOOTER_BUTTON = "size-8";

export function VaultFooter({
  onToday,
  onSwitcher,
  onOpenGraph,
  onTemplates,
  onSettings,
  ...more
}: Readonly<
  {
    onToday?: () => void;
    onSwitcher?: () => void;
    onOpenGraph?: () => void;
    onTemplates?: () => void;
    onSettings?: () => void;
  } & VaultMoreMenuProps
>) {
  const { t } = useTranslation(["notes"]);
  return (
    <footer className="flex h-12 shrink-0 items-center justify-between gap-1 border-t border-sidebar-border bg-sidebar px-2">
      <div className="flex min-w-0 items-center gap-0.5">
        <ShortcutButton label={t(($) => $.notes.vault.daily.open)} shortcut="notesTodayNote" side="top" className={FOOTER_BUTTON} onClick={onToday}>
          <CalendarDays aria-hidden />
        </ShortcutButton>
        <ShortcutButton
          label={t(($) => $.notes.vault.switcher.open)}
          shortcut="notesQuickSwitcher"
          side="top"
          className={FOOTER_BUTTON}
          onClick={onSwitcher}
        >
          <FileSearch aria-hidden />
        </ShortcutButton>
        {onOpenGraph && (
          <ShortcutButton label={t(($) => $.notes.graph.openGraph)} shortcut="notesGraph" side="top" className={FOOTER_BUTTON} onClick={onOpenGraph}>
            <Waypoints aria-hidden />
          </ShortcutButton>
        )}
        <TooltipIconButton
          label={t(($) => $.notes.vault.templates.open)}
          side="top"
          className={FOOTER_BUTTON}
          disabled={!onTemplates}
          onClick={onTemplates}
        >
          <LayoutTemplate aria-hidden />
        </TooltipIconButton>
        <VaultMoreMenu {...more} />
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        <ThemeToggleButton side="top" className={FOOTER_BUTTON} />
        <TooltipIconButton label={t(($) => $.notes.library.settings)} side="top" className={FOOTER_BUTTON} disabled={!onSettings} onClick={onSettings}>
          <Settings aria-hidden />
        </TooltipIconButton>
      </div>
    </footer>
  );
}
