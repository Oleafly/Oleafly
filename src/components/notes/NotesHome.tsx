import { FlaskConical } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ChatComposer } from "@/components/ai/composer/ChatComposer";
import { SectionHeading } from "@/components/ui/section-heading";
import { formatRelativeTimeFrom } from "@/lib/intl";
import { cn } from "@/lib/utils";
import { Byline, KindBadge, NoteChip } from "./note-icons";
import { useNotesData } from "./notes-data";
import { ProjectDot, projectStyle, useProjectColor } from "./project-color";
import type { ArtifactItem, NoteItem } from "./types";

interface NotesHomeProps {
  iconFor: (note: NoteItem) => string | undefined;
  onOpenNote: (id: string) => void;
  onOpenArtifact: (artifact: ArtifactItem) => void;
  onStartNote?: (prompt: string) => void;
}

const CARD = "rounded-lg border bg-card p-3 text-left transition-colors hover:bg-accent/35 focus-visible:bg-accent/60";
const META_TEXT = "text-[0.6875rem] text-muted-foreground";
const META = `block ${META_TEXT}`;
const NO_ATTACHMENTS: [] = [];

export function NotesHome({ iconFor, onOpenNote, onOpenArtifact, onStartNote }: Readonly<NotesHomeProps>) {
  const { t } = useTranslation(["notes"]);
  const { notes, artifacts, experiments } = useNotesData();
  const [text, setText] = useState("");
  const colorOf = useProjectColor();
  const now = Date.now();
  const when = (timestamp: number) => formatRelativeTimeFrom(timestamp, now, { dateAfterDays: 7 });

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-background">
      <div className="mx-auto max-w-4xl space-y-8 px-8 py-10">
        <header className="space-y-4">
          <h2 className="text-2xl font-bold">{t(($) => $.notes.home.title)}</h2>
          {onStartNote && (
            <ChatComposer
              composerId="notes-home"
              value={text}
              onChange={setText}
              onSubmit={() => {
                onStartNote?.(text.trim());
                setText("");
              }}
              placeholder={t(($) => $.notes.home.composerPlaceholder)}
              attachments={NO_ATTACHMENTS}
              labels={{ textarea: t(($) => $.notes.home.composerLabel) }}
              shellClassName="shadow-none"
            />
          )}
        </header>

        {experiments.length > 0 && (
          <section className="space-y-2">
            <SectionHeading>{t(($) => $.notes.home.experiments)}</SectionHeading>
            <div className="grid gap-2 sm:grid-cols-2">
              {experiments.map((experiment) => {
                const color = colorOf(experiment.projectId);
                return (
                  <button
                    key={experiment.projectId}
                    type="button"
                    style={projectStyle(color)}
                    data-project-color={color ?? "none"}
                    className={cn(CARD, color && "note-project-card")}
                    onClick={() => onOpenNote(experiment.noteId)}
                  >
                    <span className="flex items-center gap-2.5 text-sm font-medium">
                      <span
                        className={cn(
                          "flex size-7 shrink-0 items-center justify-center rounded-full",
                          color ? "note-project-chip" : "bg-muted text-muted-foreground",
                        )}
                      >
                        <FlaskConical aria-hidden className="size-3.5" />
                      </span>
                      <span className="truncate">{experiment.project}</span>
                    </span>
                    <span className={cn("mt-2", META)}>
                      {[
                        t(($) => $.notes.home.tasks, { count: experiment.tasks }),
                        t(($) => $.notes.home.figures, { count: experiment.figures }),
                        t(($) => $.notes.home.reports, { count: experiment.reports }),
                        when(experiment.updatedAt),
                      ].join(" · ")}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {notes.length > 0 && (
          <section className="space-y-2">
            <SectionHeading>{t(($) => $.notes.home.recentNotes)}</SectionHeading>
            <div className="grid gap-2 sm:grid-cols-2">
              {notes.map((note) => {
                const color = colorOf(note.relatedProjectId);
                return (
                  <button
                    key={note.id}
                    type="button"
                    style={projectStyle(color)}
                    data-project-color={color ?? "none"}
                    className={cn(CARD, color && "note-project-accent")}
                    onClick={() => onOpenNote(note.id)}
                  >
                    <span className="flex items-center gap-2.5 text-sm font-medium">
                      <NoteChip icon={iconFor(note)} color={note.color} className="size-7 rounded-full" />
                      <span className="truncate">{note.title}</span>
                    </span>
                    <span className={cn("mt-1.5 line-clamp-2", META_TEXT)}>{note.summary}</span>
                    <Byline author={note.author} agent={note.agent} when={when(note.updatedAt)} className={cn("mt-2", META_TEXT)} />
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {artifacts.length > 0 && (
          <section className="space-y-2">
            <SectionHeading>{t(($) => $.notes.home.recentArtifacts)}</SectionHeading>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {artifacts.map((artifact) => (
                <button key={artifact.id} type="button" className={CARD} onClick={() => onOpenArtifact(artifact)}>
                  <KindBadge kind={artifact.kind} label={t(($) => $.notes.artifacts.kind[artifact.kind])} />
                  <span className="mt-2 line-clamp-2 block text-sm font-medium">{artifact.title}</span>
                  <span className={cn("mt-2 flex min-w-0 items-center gap-1.5", META_TEXT)}>
                    <ProjectDot color={colorOf(artifact.projectId)} className="size-1.5" />
                    <span className="truncate">{artifact.project}</span>
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
