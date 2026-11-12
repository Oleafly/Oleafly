import type { Editor } from "@tiptap/core";
import { useEditorState } from "@tiptap/react";
import { BookOpen, CalendarClock, CalendarPlus, CaseSensitive, Rows3, WholeWord, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { EmptyState } from "@/components/ui/empty";
import { formatNumber, formatRelativeTimeFrom } from "@/lib/intl";
import { createdAt } from "./home-notes";
import { NoteChip } from "./note-icons";
import { noteStats, readingMinutes } from "./note-word-count";
import { NotePanelSections } from "./NoteListItem";
import type { NoteItem } from "./types";

const MINUTES: Intl.NumberFormatOptions = { style: "unit", unit: "minute", unitDisplay: "short" };

interface Stat {
  id: string;
  icon: LucideIcon;
  label: string;
  value: string;
}

function NoteInfoStats({ editor, note }: Readonly<{ editor: Editor; note: NoteItem }>) {
  const { t } = useTranslation(["notes"]);
  const stats = useEditorState({ editor, selector: ({ editor: current }) => noteStats(current) });
  const minutes = readingMinutes(stats.words);
  const now = Date.now();
  const when = (timestamp: number) => formatRelativeTimeFrom(timestamp, now, { dateAfterDays: 7 });
  const rows: Stat[] = [
    ...(note.updatedAt > 0
      ? [
          { id: "created", icon: CalendarPlus, label: t(($) => $.notes.info.created), value: when(createdAt(note)) },
          { id: "updated", icon: CalendarClock, label: t(($) => $.notes.info.updated), value: when(note.updatedAt) },
        ]
      : []),
    { id: "words", icon: WholeWord, label: t(($) => $.notes.info.words), value: formatNumber(stats.words) },
    { id: "characters", icon: CaseSensitive, label: t(($) => $.notes.info.characters), value: formatNumber(stats.characters) },
    { id: "lines", icon: Rows3, label: t(($) => $.notes.info.lines), value: formatNumber(stats.lines) },
    { id: "reading", icon: BookOpen, label: t(($) => $.notes.info.readingTime), value: minutes < 1 ? t(($) => $.notes.info.underMinute) : formatNumber(minutes, MINUTES) },
  ];
  return (
    <dl aria-label={t(($) => $.notes.info.details)} className="border-b px-1.5 py-1.5">
      {rows.map(({ id, icon: Icon, label, value }) => (
        <div key={id} data-note-stat={id} className="flex h-7 items-center gap-2 px-2 text-sm">
          <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          <dt className="min-w-0 flex-1 truncate text-muted-foreground">{label}</dt>
          <dd className="shrink-0 tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function NoteInfo({
  editor,
  note,
  icon,
  color,
  title,
  children,
}: Readonly<{ editor: Editor; note: NoteItem; icon?: string; color?: string; title: string; children: ReactNode }>) {
  const { t } = useTranslation(["notes"]);
  return (
    <div data-note-info={note.id} className="flex flex-col">
      <div className="flex min-w-0 items-center gap-2 border-b px-3.5 py-2.5">
        <NoteChip icon={icon} color={color} />
        <h2 className="min-w-0 truncate text-sm font-semibold">{title || t(($) => $.notes.document.untitled)}</h2>
      </div>
      <NoteInfoStats editor={editor} note={note} />
      <NotePanelSections>{children}</NotePanelSections>
    </div>
  );
}

export function NoteInfoPanel({ onTarget }: Readonly<{ onTarget: (element: HTMLElement | null) => void }>) {
  const { t } = useTranslation(["notes"]);
  return (
    <section aria-label={t(($) => $.notes.info.title)} className="flex h-full min-h-0 w-full min-w-0 flex-col bg-background">
      <div ref={onTarget} className="peer min-h-0 flex-1 overflow-y-auto empty:hidden" />
      <EmptyState className="hidden h-full p-6 peer-empty:flex" description={t(($) => $.notes.info.noNote)} />
    </section>
  );
}
