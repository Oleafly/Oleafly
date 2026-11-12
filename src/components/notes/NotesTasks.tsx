import { ChevronDown, ListChecks, SearchX } from "lucide-react";
import { memo, type RefObject, useCallback, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CheckBadge } from "@/components/ui/check-badge";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { EmptyMedia, EmptyState, ErrorState, LoadingState } from "@/components/ui/empty";
import { Tooltip } from "@/components/ui/tooltip";
import { ROW_WINDOW_ITEM, useRowWindow } from "@/hooks/use-row-window";
import { notifyError } from "@/lib/toast";
import { cn } from "@/lib/utils";
import {
  DEFAULT_TASK_PREFS,
  TASK_DUES,
  TASK_PRIORITIES,
  TASK_STATES,
  type TaskPrefs,
  useNotesPrefsStore,
} from "@/store/notes-prefs";
import { DUE_KEY, fieldDisplay, isoDate, PRIORITY_KEY, SCHEDULED_KEY } from "./note-fields";
import { NoteChip } from "./note-icons";
import { tagTone } from "./note-tags";
import { filterTasks, type TaskEntry, taskEntries, toggleTask } from "./note-task-list";
import { localDate } from "./note-templates";
import { useNoteTasks, useNotesData } from "./notes-data";
import type { NoteItem } from "./types";
import { FieldChip } from "./FieldChip";

const UNMEASURED_ROWS = 24;

interface NotesTasksProps {
  search: string;
  scrollRef: RefObject<HTMLElement | null>;
  iconFor: (note: NoteItem) => string | undefined;
  onOpenNote: (id: string) => void;
}

interface MenuOption<T> {
  value: T;
  label: string;
}

export function FilterMenu<T>({
  label,
  value,
  options,
  onChange,
  active,
}: Readonly<{ label: string; value: T; options: readonly MenuOption<T>[]; onChange: (value: T) => void; active: boolean }>) {
  const current = options.find((option) => option.value === value) ?? options[0];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          aria-label={`${label}: ${current.label}`}
          className={cn("gap-1 px-2 font-normal text-muted-foreground data-[state=open]:bg-accent", active && "bg-accent/60 text-foreground")}
        >
          <span className="max-w-[10rem] truncate">{current.label}</span>
          <ChevronDown aria-hidden className="opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={4} className="max-h-80 w-[13rem] overflow-y-auto">
        {options.map((option) => (
          <DropdownMenuItem key={String(option.value)} className="gap-2" onSelect={() => onChange(option.value)}>
            <span className="min-w-0 flex-1 truncate">{option.label}</span>
            {option.value === value && <CheckBadge />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function setTaskPrefs(patch: Partial<TaskPrefs>): void {
  const store = useNotesPrefsStore.getState();
  store.set("tasks", { ...store.tasks, ...patch });
}

const TaskRow = memo(function TaskRow({
  entry,
  checked,
  icon,
  now,
  locale,
  onToggle,
  onOpenNote,
}: Readonly<{
  entry: TaskEntry;
  checked: boolean;
  icon: string | undefined;
  now: Date;
  locale: string;
  onToggle: (entry: TaskEntry) => void;
  onOpenNote: (id: string) => void;
}>) {
  const { t } = useTranslation(["notes"]);
  const chips = [
    entry.due ? { key: DUE_KEY, value: entry.due } : null,
    entry.scheduled ? { key: SCHEDULED_KEY, value: entry.scheduled } : null,
    entry.priority ? { key: PRIORITY_KEY, value: entry.priority } : null,
  ].flatMap((field) => (field ? [{ field, display: fieldDisplay({ key: field.key, value: ` ${field.value}` }, now, locale) }] : []));
  const text = entry.text || t(($) => $.notes.kb.tasks.empty);
  return (
    <li
      {...{ [ROW_WINDOW_ITEM]: "" }}
      data-task-row={entry.key}
      data-checked={checked}
      className="group flex h-10 items-center gap-3 border-b border-border/60"
    >
      <Checkbox
        className="note-task-check"
        checked={checked}
        onCheckedChange={() => onToggle(entry)}
        aria-label={checked ? t(($) => $.notes.tasks.reopen, { text }) : t(($) => $.notes.tasks.complete, { text })}
      />
      <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
        <span className={cn("min-w-0 truncate text-sm", checked && "text-muted-foreground line-through")}>{text}</span>
        {chips.map(({ field, display }) => (
          <Tooltip key={field.key} label={display.label} className="shrink-0">
            <FieldChip display={display} />
          </Tooltip>
        ))}
        {entry.ownTags.map((tag) => {
          const tone = tagTone(tag);
          return (
            <Badge key={tag} variant="muted" size="sm" className={cn("shrink-0", tone.tint, tone.text)}>
              #{tag}
            </Badge>
          );
        })}
      </div>
      <Button
        variant="ghost"
        size="xs"
        className="max-w-[40%] shrink-0 gap-1.5 font-normal text-muted-foreground"
        aria-label={t(($) => $.notes.tasks.openNote, { title: entry.noteTitle })}
        onClick={() => onOpenNote(entry.noteId)}
      >
        <NoteChip icon={icon} className="size-4 rounded" />
        <span className="truncate">{entry.noteTitle}</span>
      </Button>
    </li>
  );
});

export function NotesTasks({ search, scrollRef, iconFor, onOpenNote }: Readonly<NotesTasksProps>) {
  const { t, i18n } = useTranslation(["notes"]);
  const data = useNotesData();
  const prefs = useNotesPrefsStore((state) => state.tasks);
  const records = useNoteTasks();
  const [overrides, setOverrides] = useState<ReadonlyMap<string, boolean>>(new Map());
  const listRef = useRef<HTMLUListElement>(null);
  const readable = data.noteTasks !== undefined;
  const entries = useMemo(() => {
    if (records.data) return taskEntries(records.data, data.notes);
    return readable ? null : [];
  }, [data.notes, readable, records.data]);
  const day = localDate(new Date());
  const now = useMemo(() => isoDate(day) ?? new Date(), [day]);
  const settled = useMemo(() => {
    if (!entries || overrides.size === 0) return overrides;
    const byKey = new Map(entries.map((entry) => [entry.key, entry.checked]));
    const left = new Map([...overrides].filter(([key, checked]) => byKey.get(key) !== checked));
    return left.size === overrides.size ? overrides : left;
  }, [entries, overrides]);
  if (settled !== overrides) setOverrides(settled);
  const shown = useMemo(
    () =>
      entries
        ? filterTasks(
            entries.map((entry) => (settled.has(entry.key) ? { ...entry, checked: settled.get(entry.key) === true } : entry)),
            { ...prefs, search },
            now,
          )
        : [],
    [entries, now, prefs, search, settled],
  );
  const rows = useRowWindow({ count: shown.length, scrollRef, listRef, unmeasuredCount: UNMEASURED_ROWS });
  const notesById = useMemo(() => new Map(data.notes.map((note) => [note.id, note])), [data.notes]);

  const tagOptions = useMemo(() => {
    const tags = new Set<string>();
    for (const entry of entries ?? []) for (const tag of entry.tags) tags.add(tag);
    return [...tags].sort((left, right) => left.localeCompare(right));
  }, [entries]);
  const projectOptions = useMemo(() => {
    const projects = new Map<string, string>();
    for (const entry of entries ?? []) if (entry.projectId && entry.projectName) projects.set(entry.projectId, entry.projectName);
    return [...projects].sort((left, right) => left[1].localeCompare(right[1]));
  }, [entries]);

  const latest = useRef({ data, entries });
  latest.current = { data, entries };
  const toggle = useCallback(
    (entry: TaskEntry) => {
      const current = latest.current.entries?.find((candidate) => candidate.key === entry.key) ?? entry;
      setOverrides((previous) => new Map(previous).set(entry.key, !current.checked));
      const forget = () =>
        setOverrides((previous) => {
          const next = new Map(previous);
          next.delete(entry.key);
          return next;
        });
      toggleTask(latest.current.data, current).then(
        (done) => {
          if (done) return;
          forget();
          notifyError("update a task", new Error("The task moved"), t(($) => $.notes.tasks.moved));
        },
        (error: unknown) => {
          forget();
          notifyError("update a task", error, t(($) => $.notes.tasks.toggleFailed));
        },
      );
    },
    [t],
  );

  const filtered = prefs.state !== DEFAULT_TASK_PREFS.state || prefs.due !== "any" || prefs.priority !== "any" || prefs.tag !== null || prefs.project !== null;
  const filters = (
    <fieldset className="m-0 flex min-w-0 flex-wrap items-center gap-1 border-0 p-0" aria-label={t(($) => $.notes.tasks.filters)}>
      <FilterMenu
        label={t(($) => $.notes.tasks.state.label)}
        value={prefs.state}
        active={prefs.state !== DEFAULT_TASK_PREFS.state}
        options={TASK_STATES.map((value) => ({ value, label: t(($) => $.notes.tasks.state[value]) }))}
        onChange={(state) => setTaskPrefs({ state })}
      />
      <FilterMenu
        label={t(($) => $.notes.tasks.due.label)}
        value={prefs.due}
        active={prefs.due !== "any"}
        options={TASK_DUES.map((value) => ({ value, label: t(($) => $.notes.tasks.due[value]) }))}
        onChange={(due) => setTaskPrefs({ due })}
      />
      <FilterMenu
        label={t(($) => $.notes.tasks.priority.label)}
        value={prefs.priority}
        active={prefs.priority !== "any"}
        options={TASK_PRIORITIES.map((value) => ({ value, label: t(($) => $.notes.tasks.priority[value]) }))}
        onChange={(priority) => setTaskPrefs({ priority })}
      />
      {(tagOptions.length > 0 || prefs.tag) && (
        <FilterMenu<string | null>
          label={t(($) => $.notes.tasks.tag.label)}
          value={prefs.tag}
          active={prefs.tag !== null}
          options={[{ value: null, label: t(($) => $.notes.tasks.tag.any) }, ...tagOptions.map((tag) => ({ value: tag, label: `#${tag}` }))]}
          onChange={(tag) => setTaskPrefs({ tag })}
        />
      )}
      {(projectOptions.length > 0 || prefs.project) && (
        <FilterMenu<string | null>
          label={t(($) => $.notes.tasks.project.label)}
          value={prefs.project}
          active={prefs.project !== null}
          options={[{ value: null, label: t(($) => $.notes.tasks.project.any) }, ...projectOptions.map(([value, label]) => ({ value, label }))]}
          onChange={(project) => setTaskPrefs({ project })}
        />
      )}
      {filtered && (
        <Button variant="link" size="sm" className="px-2" onClick={() => setTaskPrefs({ ...DEFAULT_TASK_PREFS, sort: prefs.sort })}>
          {t(($) => $.notes.tasks.clear)}
        </Button>
      )}
    </fieldset>
  );

  const body = () => {
    if (records.failed && !entries) return <ErrorState message={t(($) => $.notes.tasks.failed)} className="px-1 py-8" />;
    if (!entries) return <LoadingState label={t(($) => $.notes.tasks.loading)} className="px-1 py-8" />;
    if (shown.length === 0) {
      const none = entries.length === 0;
      return (
        <EmptyState
          icon={<EmptyMedia variant="icon">{none ? <ListChecks aria-hidden className="size-6" /> : <SearchX aria-hidden className="size-6" />}</EmptyMedia>}
          description={none ? t(($) => $.notes.tasks.empty) : t(($) => $.notes.tasks.noMatches)}
          className="px-6 pb-16 pt-20"
        />
      );
    }
    return (
      <ul ref={listRef} aria-label={t(($) => $.notes.tasks.list)} className="m-0 list-none p-0" style={{ paddingTop: rows.paddingTop, paddingBottom: rows.paddingBottom }}>
        {shown.slice(rows.start, rows.end).map((entry) => {
          const note = notesById.get(entry.noteId);
          return (
            <TaskRow
              key={entry.key}
              entry={entry}
              checked={entry.checked}
              icon={note ? iconFor(note) : undefined}
              now={now}
              locale={i18n.language}
              onToggle={toggle}
              onOpenNote={onOpenNote}
            />
          );
        })}
      </ul>
    );
  };

  return (
    <div data-notes-tasks className="px-6 pb-8 pt-2.5">
      <div className="flex items-center justify-between gap-3 pb-2">
        {filters}
        {entries && shown.length > 0 && <span className="shrink-0 text-xs text-muted-foreground">{t(($) => $.notes.tasks.count, { count: shown.length })}</span>}
      </div>
      {body()}
    </div>
  );
}
