import { FileInput, LayoutTemplate, Plus } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { PRIMARY_TEXT } from "@/components/layout/ReleaseNotes";
import { Button } from "@/components/ui/button";
import { SectionHeading } from "@/components/ui/section-heading";
import { formatDate } from "@/lib/intl";
import { randomFraction } from "@/lib/random";
import { cn } from "@/lib/utils";
import { shortcutLabel, useShortcutStore } from "@/store/shortcuts";
import { NoteChip } from "./note-icons";
import { localDate, TEMPLATES_BY_ID } from "./note-templates";
import { TemplatePicker, useNoteFromTemplate } from "./TemplatePicker";

export type Greeting = "begin" | "ready" | "mind" | "resume" | "working" | "first" | "blank";
type StarterId = "daily" | "experimentLog" | "paperReading" | "literatureMatrix" | "meeting" | "labProtocol" | "weeklyLog" | "proposal";

export const GREETINGS_WITH_NOTES: readonly Greeting[] = ["begin", "ready", "mind", "resume", "working"];
export const GREETINGS_FIRST_NOTE: readonly Greeting[] = ["begin", "ready", "first", "mind", "blank"];
const STARTERS: readonly StarterId[] = ["daily", "experimentLog", "paperReading", "literatureMatrix", "meeting", "labProtocol", "weeklyLog", "proposal"];
const STARTERS_WITH_NOTES = 5;
const DATE_LINE: Intl.DateTimeFormatOptions = { weekday: "long", month: "long", day: "numeric" };
export const QUIET_BUTTON = "h-7 gap-1.5 px-2 font-normal text-muted-foreground";
const TILE = "h-24 min-w-0 flex-col items-start justify-between gap-1 whitespace-normal rounded-xl bg-card p-3.5 text-left font-normal";

let lastGreeting: Greeting | null = null;

export function pickGreeting(lines: readonly Greeting[], previous: Greeting | null, random: () => number = randomFraction): Greeting {
  const choices = lines.filter((line) => line !== previous);
  return choices[Math.floor(random() * choices.length)] ?? lines[0];
}

function useGreeting(lines: readonly Greeting[]): Greeting {
  const [picked, setPicked] = useState(() => pickGreeting(lines, lastGreeting));
  if (!lines.includes(picked)) setPicked(pickGreeting(lines, picked));
  useEffect(() => {
    lastGreeting = picked;
  }, [picked]);
  return picked;
}

function Tile({
  icon,
  name,
  hint,
  disabled = false,
  onClick,
}: Readonly<{ icon: ReactNode; name: string; hint: ReactNode; disabled?: boolean; onClick: () => void }>) {
  return (
    <Button variant="outline" disabled={disabled} className={TILE} onClick={onClick}>
      {icon}
      <span className="flex w-full min-w-0 flex-col gap-0.5">
        <span className="truncate text-sm font-semibold leading-tight">{name}</span>{" "}
        <span className="truncate text-xs text-muted-foreground">{hint}</span>
      </span>
    </Button>
  );
}

interface NotesStartProps {
  hasNotes: boolean;
  onNewNote?: () => void;
  onOpenNote: (id: string) => void;
  onImport?: () => void;
  className?: string;
}

export function NotesStart({ hasNotes, onNewNote, onOpenNote, onImport, className }: Readonly<NotesStartProps>) {
  const { t } = useTranslation(["notes"]);
  const greeting = useGreeting(hasNotes ? GREETINGS_WITH_NOTES : GREETINGS_FIRST_NOTE);
  const [today] = useState(() => new Date());
  const [picking, setPicking] = useState(false);
  const newNoteKeys = useShortcutStore((state) => shortcutLabel(state.bindings.notesNewNote));
  const template = useNoteFromTemplate(onOpenNote);
  const starters = hasNotes ? STARTERS.slice(0, STARTERS_WITH_NOTES) : STARTERS;

  return (
    <div data-notes-start className={cn("@container flex w-full flex-col gap-6", className)}>
      <div className="flex flex-col gap-1.5 text-center">
        {hasNotes && (
          <SectionHeading as="p" className={PRIMARY_TEXT}>
            <time dateTime={localDate(today)}>{formatDate(today, DATE_LINE)}</time>
          </SectionHeading>
        )}
        <h2 className="text-balance text-3xl font-normal tracking-tight">{t(($) => $.notes.workspace.empty.greetings[greeting])}</h2>
      </div>
      {(onNewNote || template.canCreate) && (
        <div className="flex flex-col gap-2">
          <div className="grid grid-cols-1 gap-3 @min-[26rem]:grid-cols-2 @min-[36rem]:grid-cols-3">
            {onNewNote && (
              <Tile
                icon={
                  <span aria-hidden className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-foreground">
                    <Plus />
                  </span>
                }
                name={t(($) => $.notes.vault.templates.blank)}
                hint={<span aria-hidden>{newNoteKeys}</span>}
                onClick={onNewNote}
              />
            )}
            {template.canCreate &&
              starters.map((id) => (
                <Tile
                  key={id}
                  icon={<NoteChip icon={TEMPLATES_BY_ID[id].icon} color={TEMPLATES_BY_ID[id].color} className="size-7" />}
                  name={template.templateName(TEMPLATES_BY_ID[id])}
                  hint={t(($) => $.notes.workspace.empty.hints[id])}
                  disabled={template.busy}
                  onClick={() => template.fromTemplate(TEMPLATES_BY_ID[id])}
                />
              ))}
          </div>
          {(template.canCreate || onImport) && (
            <div className="flex flex-wrap justify-end gap-2">
              {onImport && (
                <Button variant="ghost" size="sm" className={QUIET_BUTTON} onClick={onImport}>
                  <FileInput aria-hidden />
                  {t(($) => $.notes.vault.import.menu)}
                </Button>
              )}
              {template.canCreate && (
                <Button variant="ghost" size="sm" className={QUIET_BUTTON} onClick={() => setPicking(true)}>
                  <LayoutTemplate aria-hidden />
                  {t(($) => $.notes.workspace.empty.moreTemplates)}
                </Button>
              )}
            </div>
          )}
        </div>
      )}
      {template.canCreate && <TemplatePicker open={picking} onOpenChange={setPicking} onCreated={onOpenNote} />}
    </div>
  );
}
