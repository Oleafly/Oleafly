import { FolderPlus, PanelLeft, PanelRight, Send } from "lucide-react";
import { useId, useState, type ComponentProps, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { HomeBrandButton } from "@/components/layout/HomeBrandButton";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Tooltip } from "@/components/ui/tooltip";
import { useFullscreen } from "@/lib/use-fullscreen";
import { cn, isMac } from "@/lib/utils";
import { ArtifactPanel } from "./ArtifactPanel";
import { NewProjectDialog, type ProjectFormat, type ProjectSeed } from "./NewProjectDialog";
import { NoteDocument, type SaveStatus } from "./NoteDocument";
import { NotesHome } from "./NotesHome";
import { NotesLibrary } from "./NotesLibrary";
import { artifactsForNote, useNotesData } from "./notes-data";
import type { ArtifactItem, NoteItem } from "./types";
import "./notes.css";

interface NotesWorkspaceProps {
  initialNoteId?: string | null;
  onExit?: () => void;
  onNewNote?: () => Promise<string | null>;
  onStartNote?: (prompt: string) => void;
  onCreateProject?: (request: { seed: ProjectSeed; name: string; format: ProjectFormat; files: readonly string[] }) => void;
  onSendToPaper?: (request: { paperId: string; text: string }) => void;
}

function IconAction({
  label,
  children,
  className,
  ...props
}: Readonly<{ label: string; children: ReactNode } & ComponentProps<typeof Button>>) {
  return (
    <Tooltip label={label} side="bottom">
      <Button variant="ghost" size="icon" aria-label={label} className={cn("relative size-7", className)} {...props}>
        {children}
      </Button>
    </Tooltip>
  );
}

export function NotesWorkspace({
  initialNoteId = null,
  onExit,
  onNewNote,
  onStartNote,
  onCreateProject,
  onSendToPaper,
}: Readonly<NotesWorkspaceProps>) {
  const { t } = useTranslation(["notes", "common"]);
  const data = useNotesData();
  const [noteId, setNoteId] = useState<string | null>(initialNoteId);
  const [status, setStatus] = useState<SaveStatus>("saved");
  const [artifactId, setArtifactId] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [insertRequest, setInsertRequest] = useState<{ artifact: ArtifactItem; id: number } | null>(null);
  const [paperText, setPaperText] = useState<string | null>(null);
  const [paperId, setPaperId] = useState(data.papers[0]?.id ?? "");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const fullscreen = useFullscreen();
  const headerInset = !sidebarOpen && isMac && !fullscreen && "pl-[78px]";
  const [projectSeed, setProjectSeed] = useState<ProjectSeed | null>(null);
  const paperFieldId = useId();
  const iconFor = (item: NoteItem) => item.icon;

  const note = data.notes.find((candidate) => candidate.id === noteId) ?? null;
  const artifactCount = note ? artifactsForNote(data.artifacts, note.id).length : 0;

  const openNote = (id: string) => {
    setNoteId(id);
    setArtifactId(null);
    setStatus("saved");
  };
  const newNote = onNewNote
    ? () => {
        void onNewNote().then((id) => {
          if (id) openNote(id);
        });
      }
    : undefined;
  const openArtifact = (artifact: ArtifactItem) => {
    const owner = artifact.noteIds[0];
    if (!owner) return;
    setNoteId(owner);
    setArtifactId(artifact.id);
    setPanelOpen(true);
  };
  const goHome = () => {
    if (!note && onExit) {
      onExit();
      return;
    }
    setNoteId(null);
    setArtifactId(null);
  };

  const sidebarLabel = sidebarOpen ? t(($) => $.notes.workspace.hideSidebar) : t(($) => $.notes.workspace.showSidebar);
  const sidebarToggle = (
    <div className="flex shrink-0 items-center gap-1">
      {!sidebarOpen && <HomeBrandButton compact onClick={goHome} />}
      <IconAction label={sidebarLabel} aria-expanded={sidebarOpen} onClick={() => setSidebarOpen((open) => !open)}>
        <PanelLeft aria-hidden className="size-4" />
      </IconAction>
    </div>
  );

  return (
    <div className="flex h-full min-h-0 bg-background text-foreground">
      {sidebarOpen && (
        <NotesLibrary
          iconFor={iconFor}
          activeNoteId={noteId}
          activeArtifactId={artifactId}
          onHome={goHome}
          onNewNote={newNote}
          onOpenNote={openNote}
          onOpenArtifact={openArtifact}
        />
      )}
      {note ? (
        <main className="flex min-w-0 flex-1 flex-col">
          <header
            data-tauri-drag-region
            className={cn("flex min-h-12 shrink-0 items-center justify-between gap-3 border-b px-2", headerInset)}
          >
            <div className="flex min-w-0 items-center gap-2">
              {sidebarToggle}
              <p className="min-w-0 truncate text-sm text-muted-foreground">
                {note.project} / <span className="text-foreground">{note.title}</span>
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <span aria-live="polite" className={cn("pr-2 text-xs", status === "failed" ? "text-destructive" : "text-muted-foreground")}>
                {status === "saved" && t(($) => $.notes.workspace.saved)}
                {status === "saving" && t(($) => $.notes.workspace.saving)}
                {status === "failed" && t(($) => $.notes.workspace.saveFailed)}
              </span>
              <IconAction
                label={t(($) => $.notes.workspace.newProject)}
                onClick={() => setProjectSeed({ noteId: note.id, artifactId: null })}
              >
                <FolderPlus aria-hidden className="size-4" />
              </IconAction>
              <IconAction label={t(($) => $.notes.workspace.sendToPaper)} onClick={() => setPaperText(note.summary)}>
                <Send aria-hidden className="size-4" />
              </IconAction>
              <IconAction
                label={t(($) => $.notes.workspace.artifacts, { total: artifactCount })}
                aria-pressed={panelOpen}
                className={cn(panelOpen && "bg-accent")}
                onClick={() => setPanelOpen((open) => !open)}
              >
                <PanelRight aria-hidden className="size-4" />
                {artifactCount > 0 && (
                  <span className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-[0.875rem] items-center justify-center rounded-full border border-background bg-primary px-1 text-[0.5625rem] font-bold text-primary-foreground">
                    {artifactCount}
                  </span>
                )}
              </IconAction>
            </div>
          </header>
          <div className="flex min-h-0 flex-1">
            <NoteDocument
              key={note.id}
              note={note}
              insertRequest={insertRequest}
              onSendToPaper={setPaperText}
              onStatusChange={setStatus}
            />
            {panelOpen && (
              <ArtifactPanel
                noteId={note.id}
                selectedId={artifactId}
                onSelect={setArtifactId}
                onClose={() => setPanelOpen(false)}
                onInsert={(artifact) => setInsertRequest({ artifact, id: (insertRequest?.id ?? 0) + 1 })}
                onNewProject={(artifact) => setProjectSeed({ noteId: note.id, artifactId: artifact.id })}
              />
            )}
          </div>
        </main>
      ) : (
        <main className="flex min-w-0 flex-1 flex-col">
          <header
            data-tauri-drag-region
            className={cn("flex min-h-12 shrink-0 items-center gap-2 border-b px-2", headerInset)}
          >
            {sidebarToggle}
            <p className="text-sm text-muted-foreground">{t(($) => $.notes.workspace.home)}</p>
          </header>
          <NotesHome iconFor={iconFor} onOpenNote={openNote} onOpenArtifact={openArtifact} onStartNote={onStartNote} />
        </main>
      )}
      {projectSeed && (
        <NewProjectDialog
          key={`${projectSeed.noteId}-${projectSeed.artifactId}`}
          seed={projectSeed}
          onClose={() => setProjectSeed(null)}
          onCreate={
            onCreateProject &&
            ((request) => {
              onCreateProject({ seed: projectSeed, ...request });
              setProjectSeed(null);
            })
          }
        />
      )}
      <Dialog open={paperText !== null} onOpenChange={(open) => !open && setPaperText(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t(($) => $.notes.sendToPaper.title)}</DialogTitle>
            <DialogDescription>{t(($) => $.notes.sendToPaper.description)}</DialogDescription>
          </DialogHeader>
          <p className="line-clamp-3 rounded-md border p-2 text-sm text-muted-foreground">{paperText}</p>
          <RadioGroup value={paperId} onValueChange={setPaperId} className="gap-1">
            {data.papers.map((paper) => (
              <label key={paper.id} htmlFor={`${paperFieldId}-${paper.id}`} className="flex items-center gap-2 text-sm">
                <RadioGroupItem id={`${paperFieldId}-${paper.id}`} value={paper.id} />
                {paper.label}
              </label>
            ))}
          </RadioGroup>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPaperText(null)}>
              {t(($) => $.common.actions.cancel)}
            </Button>
            <Button
              disabled={!onSendToPaper || !paperId}
              onClick={() => {
                if (paperText !== null) onSendToPaper?.({ paperId, text: paperText });
                setPaperText(null);
              }}
            >
              {t(($) => $.notes.sendToPaper.send)}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
