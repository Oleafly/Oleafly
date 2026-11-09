import { CalendarDays, ChevronRight, FileSearch, LayoutTemplate, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import type { NoteSearchHit } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import { isSelectionModifier } from "@/store/library-selection";
import { shortcutLabel, useShortcutStore } from "@/store/shortcuts";
import { NoteChip } from "./note-icons";
import type { TagNode } from "./note-search";
import { Highlighted } from "./NoteMentions";
import type { NoteItem } from "./types";

export interface SearchRow {
  hit: NoteSearchHit;
  note: NoteItem;
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
  onOpen: (id: string, newTab: boolean) => void;
}>) {
  return (
    <div id={listId} role="listbox" aria-label={label} className="space-y-0.5">
      {rows.map(({ hit, note }, index) => {
        const snippet = hit.snippets[0];
        return (
          <div
            key={hit.id}
            id={optionId(listId, index)}
            role="option"
            tabIndex={-1}
            aria-selected={index === active}
            data-search-hit={hit.id}
            onMouseMove={() => {
              if (index !== active) onActiveChange(index);
            }}
            onMouseDown={(event) => event.preventDefault()}
            onClick={(event) => onOpen(hit.id, isSelectionModifier(event))}
            onKeyDown={(event) => {
              if (event.key === "Enter") onOpen(hit.id, isSelectionModifier(event));
            }}
            className={cn(
              "flex cursor-default items-start gap-2.5 rounded-md px-2 py-1.5 text-left",
              index === active && "bg-sidebar-accent",
              activeNoteId === hit.id && "bg-primary/10",
            )}
          >
            <NoteChip icon={note.icon} color={note.color} className="mt-0.5" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm">
                <Highlighted text={hit.title} ranges={hit.titleRanges} />
              </span>
              {snippet && (
                <span className="mt-0.5 line-clamp-2 text-[0.6875rem] text-muted-foreground">
                  <Highlighted text={snippet.text} ranges={snippet.ranges} />
                </span>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function TagBranch({
  node,
  depth,
  selected,
  open,
  onToggle,
  onSelect,
}: Readonly<{
  node: TagNode;
  depth: number;
  selected: string | null;
  open: ReadonlySet<string>;
  onToggle: (tag: string) => void;
  onSelect: (tag: string) => void;
}>) {
  const { t } = useTranslation(["notes"]);
  const expanded = open.has(node.tag) || Boolean(selected?.startsWith(`${node.tag}/`));
  const hasChildren = node.children.length > 0;
  return (
    <li>
      <div className="flex items-center" style={{ paddingLeft: `${depth * 0.75}rem` }}>
        {hasChildren ? (
          <button
            type="button"
            aria-expanded={expanded}
            aria-label={
              expanded
                ? t(($) => $.notes.vault.tags.collapse, { tag: node.tag })
                : t(($) => $.notes.vault.tags.expand, { tag: node.tag })
            }
            onClick={() => onToggle(node.tag)}
            className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-sidebar-accent focus-visible:bg-sidebar-accent"
          >
            <ChevronRight
              aria-hidden
              className={cn("size-3 transition-transform motion-reduce:transition-none", expanded && "rotate-90")}
            />
          </button>
        ) : (
          <span aria-hidden className="size-5 shrink-0" />
        )}
        <button
          type="button"
          aria-pressed={selected === node.tag}
          aria-label={t(($) => $.notes.vault.tags.filter, { tag: node.tag })}
          onClick={() => onSelect(node.tag)}
          className={cn(
            "flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 py-0.5 text-left text-xs transition-colors hover:bg-sidebar-accent focus-visible:bg-sidebar-accent motion-reduce:transition-none",
            selected === node.tag && "bg-primary/10 text-primary hover:bg-primary/15 focus-visible:bg-primary/15",
          )}
        >
          <span className="min-w-0 flex-1 truncate">#{node.name}</span>
          <span className="shrink-0 text-[0.6875rem] tabular-nums text-muted-foreground">{node.count}</span>
        </button>
      </div>
      {hasChildren && expanded && (
        <ul>
          {node.children.map((child) => (
            <TagBranch
              key={child.tag}
              node={child}
              depth={depth + 1}
              selected={selected}
              open={open}
              onToggle={onToggle}
              onSelect={onSelect}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

export function TagPane({
  tree,
  selected,
  onSelect,
}: Readonly<{ tree: readonly TagNode[] | null; selected: string | null; onSelect: (tag: string | null) => void }>) {
  const { t } = useTranslation(["notes"]);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  if (tree === null) return null;
  if (tree.length === 0) return <p className="px-1 text-xs text-muted-foreground">{t(($) => $.notes.vault.tags.empty)}</p>;
  const toggle = (tag: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (!next.delete(tag)) next.add(tag);
      return next;
    });
  return (
    <ul aria-label={t(($) => $.notes.vault.tags.label)} className="max-h-56 overflow-y-auto">
      {tree.map((node) => (
        <TagBranch
          key={node.tag}
          node={node}
          depth={0}
          selected={selected}
          open={open}
          onToggle={toggle}
          onSelect={(tag) => onSelect(tag === selected ? null : tag)}
        />
      ))}
    </ul>
  );
}

export function TagChip({ tag, onClear }: Readonly<{ tag: string; onClear: () => void }>) {
  const { t } = useTranslation(["notes"]);
  return (
    <button
      type="button"
      onClick={onClear}
      aria-label={t(($) => $.notes.vault.tags.clear, { tag })}
      className="flex max-w-full items-center gap-1 rounded-full border border-primary/30 bg-primary/10 py-0.5 pl-2 pr-1 text-[0.6875rem] text-primary transition-colors hover:bg-primary/15 focus-visible:bg-primary/15 motion-reduce:transition-none"
    >
      <span className="truncate">#{tag}</span>
      <X aria-hidden className="size-3 shrink-0" />
    </button>
  );
}

function HeaderAction({
  label,
  shortcut,
  disabled,
  onClick,
  children,
}: Readonly<{ label: string; shortcut: string; disabled?: boolean; onClick?: () => void; children: ReactNode }>) {
  const { t } = useTranslation(["notes"]);
  return (
    <Tooltip label={t(($) => $.notes.vault.withShortcut, { label, shortcut })} side="bottom">
      <Button variant="ghost" size="icon" aria-label={label} className="size-7" disabled={disabled} onClick={onClick}>
        {children}
      </Button>
    </Tooltip>
  );
}

export function VaultHeaderActions({
  onToday,
  onSwitcher,
}: Readonly<{ onToday?: () => void; onSwitcher?: () => void }>) {
  const { t } = useTranslation(["notes"]);
  const today = useShortcutStore((state) => shortcutLabel(state.bindings.notesTodayNote));
  const switcher = useShortcutStore((state) => shortcutLabel(state.bindings.notesQuickSwitcher));
  return (
    <>
      <HeaderAction
        label={t(($) => $.notes.vault.daily.open)}
        shortcut={today}
        disabled={!onToday}
        onClick={onToday}
      >
        <CalendarDays aria-hidden />
      </HeaderAction>
      <HeaderAction label={t(($) => $.notes.vault.switcher.open)} shortcut={switcher} disabled={!onSwitcher} onClick={onSwitcher}>
        <FileSearch aria-hidden />
      </HeaderAction>
    </>
  );
}

export function TemplateButton({ onClick }: Readonly<{ onClick?: () => void }>) {
  const { t } = useTranslation(["notes"]);
  return (
    <Tooltip label={t(($) => $.notes.vault.templates.open)} side="bottom">
      <Button
        variant="ghost"
        size="icon"
        aria-label={t(($) => $.notes.vault.templates.open)}
        className="size-9 shrink-0"
        disabled={!onClick}
        onClick={onClick}
      >
        <LayoutTemplate aria-hidden />
      </Button>
    </Tooltip>
  );
}
