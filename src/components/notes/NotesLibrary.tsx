import { Plus, Search } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { HomeBrandButton } from "@/components/layout/HomeBrandButton";
import { SIDEBAR_TITLE_CLASS } from "@/components/layout/SidebarSection";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip } from "@/components/ui/tooltip";
import { formatRelativeTimeFrom } from "@/lib/intl";
import { useFullscreen } from "@/lib/use-fullscreen";
import { cn, isMac } from "@/lib/utils";
import { artifactIcon, NoteIcon } from "./note-icons";
import { useNotesData } from "./notes-data";
import type { ArtifactItem, ArtifactKind, Author, NoteItem } from "./types";

type KindFilter = "all" | "note" | Exclude<ArtifactKind, "html">;
type AuthorFilter = "all" | Author;

const KIND_FILTERS: readonly KindFilter[] = ["all", "note", "figure", "report", "run"];
const AUTHOR_FILTERS: readonly AuthorFilter[] = ["all", "agent", "you"];

interface NotesLibraryProps {
  iconFor: (note: NoteItem) => string | undefined;
  activeNoteId: string | null;
  activeArtifactId: string | null;
  onHome: () => void;
  onNewNote?: () => void;
  onOpenNote: (id: string) => void;
  onOpenArtifact: (artifact: ArtifactItem) => void;
}

function Row({
  active,
  icon,
  title,
  meta,
  onClick,
}: Readonly<{ active: boolean; icon: ReactNode; title: string; meta: string; onClick: () => void }>) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-sidebar-accent focus-visible:bg-sidebar-accent",
        active && "bg-sidebar-accent",
      )}
    >
      <span className="mt-0.5 flex size-4 items-center justify-center">{icon}</span>
      <span className="min-w-0">
        <span className="block truncate text-sm">{title}</span>
        <span className="block truncate text-[0.6875rem] text-muted-foreground">{meta}</span>
      </span>
    </button>
  );
}

function matchesKind(kind: KindFilter, artifact: ArtifactItem): boolean {
  if (kind === "all") return true;
  if (kind === "figure") return artifact.kind === "figure" || artifact.kind === "html";
  return artifact.kind === kind;
}

export function NotesLibrary({
  iconFor,
  activeNoteId,
  activeArtifactId,
  onHome,
  onNewNote,
  onOpenNote,
  onOpenArtifact,
}: Readonly<NotesLibraryProps>) {
  const { t } = useTranslation(["notes"]);
  const { notes, artifacts } = useNotesData();
  const [kind, setKind] = useState<KindFilter>("all");
  const [author, setAuthor] = useState<AuthorFilter>("all");
  const [query, setQuery] = useState("");
  const fullscreen = useFullscreen();

  const groups = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    const matches = (item: { title: string; author: Author }) =>
      (author === "all" || item.author === author) && (needle === "" || item.title.toLocaleLowerCase().includes(needle));
    const shownNotes = kind === "all" || kind === "note" ? notes.filter(matches) : [];
    const shownArtifacts = kind === "note" ? [] : artifacts.filter((item) => matchesKind(kind, item) && matches(item));
    const projects = new Map<string, { notes: NoteItem[]; artifacts: ArtifactItem[] }>();
    const groupFor = (project: string) => {
      const group = projects.get(project) ?? { notes: [], artifacts: [] };
      projects.set(project, group);
      return group;
    };
    for (const note of shownNotes) groupFor(note.project).notes.push(note);
    for (const artifact of shownArtifacts) groupFor(artifact.project).artifacts.push(artifact);
    return [...projects.entries()];
  }, [artifacts, author, kind, notes, query]);

  const now = Date.now();
  const meta = (item: { author: Author; agent?: string; updatedAt: number }) =>
    [
      item.author === "agent" ? (item.agent ?? t(($) => $.notes.library.agentFallback)) : t(($) => $.notes.library.author.you),
      formatRelativeTimeFrom(item.updatedAt, now, { dateAfterDays: 7 }),
    ].join(" · ");

  return (
    <aside className="flex h-full w-72 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
      <div
        data-tauri-drag-region
        className={cn("flex min-h-12 shrink-0 items-center justify-between px-2", isMac && !fullscreen && "pl-[78px]")}
      >
        <HomeBrandButton onClick={onHome} />
        <Tooltip label={t(($) => $.notes.library.newNote)} side="bottom">
          <Button
            variant="ghost"
            size="icon"
            aria-label={t(($) => $.notes.library.newNote)}
            className="size-7"
            disabled={!onNewNote}
            onClick={onNewNote}
          >
            <Plus aria-hidden />
          </Button>
        </Tooltip>
      </div>
      <div className="space-y-2 border-b border-sidebar-border p-2">
        <div className="relative">
          <Search
            aria-hidden
            className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            aria-label={t(($) => $.notes.library.search)}
            placeholder={t(($) => $.notes.library.search)}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="pl-7 focus-visible:border-input focus-visible:bg-accent/40"
          />
        </div>
        <Tabs value={kind} onValueChange={(value) => setKind(value as KindFilter)}>
          <TabsList size="sm" fill>
            {KIND_FILTERS.map((value) => (
              <TabsTrigger key={value} value={value}>
                {t(($) => $.notes.library.kind[value])}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <Tabs value={author} onValueChange={(value) => setAuthor(value as AuthorFilter)}>
          <TabsList size="sm" fill>
            {AUTHOR_FILTERS.map((value) => (
              <TabsTrigger key={value} value={value}>
                {t(($) => $.notes.library.author[value])}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-1.5">
        {groups.length === 0 && (
          <p className="px-2 py-3 text-xs text-muted-foreground">
            {notes.length + artifacts.length === 0
              ? t(($) => $.notes.library.noNotes)
              : t(($) => $.notes.library.empty)}
          </p>
        )}
        {groups.map(([project, group]) => (
          <section key={project}>
            <h2 className={cn("px-2 pb-1", SIDEBAR_TITLE_CLASS)}>{project}</h2>
            {group.notes.map((note) => (
              <Row
                key={note.id}
                active={activeNoteId === note.id && activeArtifactId === null}
                icon={<NoteIcon icon={iconFor(note)} />}
                title={note.title}
                meta={meta(note)}
                onClick={() => onOpenNote(note.id)}
              />
            ))}
            {group.artifacts.map((artifact) => (
              <Row
                key={artifact.id}
                active={activeArtifactId === artifact.id}
                icon={artifactIcon(artifact.kind)}
                title={artifact.title}
                meta={meta(artifact)}
                onClick={() => onOpenArtifact(artifact)}
              />
            ))}
          </section>
        ))}
      </div>
    </aside>
  );
}
