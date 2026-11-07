import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { StatGrid } from "@/components/ui/stat-grid";
import { formatRelativeTimeFrom } from "@/lib/intl";
import { cn } from "@/lib/utils";
import { artifactIcon } from "./note-icons";
import { artifactsForNote, useNotesData } from "./notes-data";
import type { ArtifactItem } from "./types";

interface ArtifactPanelProps {
  noteId: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onClose: () => void;
  onInsert: (artifact: ArtifactItem) => void;
  onNewProject: (artifact: ArtifactItem) => void;
}

function ArtifactPreview({ artifact }: Readonly<{ artifact: ArtifactItem }>) {
  const { t } = useTranslation(["notes"]);
  if (artifact.kind === "html") {
    return (
      <p className="rounded-md border bg-muted/50 p-3 text-xs text-muted-foreground">
        {t(($) => $.notes.artifacts.htmlPreview)}
      </p>
    );
  }
  const preview = artifact.preview;
  if (!preview) return null;
  if (preview.type === "image") {
    return <img src={preview.src} alt={artifact.title} className="w-full rounded-md border bg-background" />;
  }
  if (preview.type === "metrics") {
    return (
      <StatGrid
        stats={preview.metrics.map((metric) => ({ id: metric.label, ...metric }))}
        className="grid-cols-2 overflow-hidden rounded-md border sm:grid-cols-2"
      />
    );
  }
  return (
    <div className="space-y-2 rounded-md border p-3 text-sm">
      <p className="font-medium">{preview.heading}</p>
      <p className="text-muted-foreground">{preview.body}</p>
    </div>
  );
}

export function ArtifactPanel({ noteId, selectedId, onSelect, onClose, onInsert, onNewProject }: Readonly<ArtifactPanelProps>) {
  const { t } = useTranslation(["notes", "common"]);
  const data = useNotesData();
  const artifacts = artifactsForNote(data.artifacts, noteId);
  const selected = artifacts.find((artifact) => artifact.id === selectedId) ?? artifacts[0] ?? null;

  return (
    <aside aria-label={t(($) => $.notes.artifacts.title)} className="flex h-full w-[22rem] shrink-0 flex-col border-l bg-background">
      <div className="flex min-h-12 items-center justify-between border-b px-3">
        <h2 className="text-sm font-medium">{t(($) => $.notes.artifacts.title)}</h2>
        <Button variant="ghost" size="icon" aria-label={t(($) => $.notes.artifacts.close)} className="size-7" onClick={onClose}>
          <X aria-hidden />
        </Button>
      </div>
      {artifacts.length === 0 ? (
        <p className="p-4 text-sm text-muted-foreground">{t(($) => $.notes.artifacts.empty)}</p>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <ul className="space-y-0.5 p-2">
            {artifacts.map((artifact) => (
              <li key={artifact.id}>
                <button
                  type="button"
                  onClick={() => onSelect(artifact.id)}
                  aria-current={selected?.id === artifact.id ? "true" : undefined}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent focus-visible:bg-accent",
                    selected?.id === artifact.id && "bg-accent",
                  )}
                >
                  {artifactIcon(artifact.kind)}
                  <span className="truncate">{artifact.title}</span>
                </button>
              </li>
            ))}
          </ul>
          {selected && (
            <section className="space-y-3 border-t p-3">
              <header>
                <h3 className="text-sm font-medium">{selected.title}</h3>
                <p className="text-xs text-muted-foreground">
                  {[
                    t(($) => $.notes.artifacts.kind[selected.kind]),
                    selected.author === "agent"
                      ? (selected.agent ?? t(($) => $.notes.library.agentFallback))
                      : t(($) => $.notes.library.author.you),
                    formatRelativeTimeFrom(selected.updatedAt, Date.now(), { dateAfterDays: 7 }),
                  ].join(" · ")}
                </p>
                <p className="text-xs text-muted-foreground">{t(($) => $.notes.artifacts.fromChat, { chat: selected.chat })}</p>
              </header>
              <ArtifactPreview artifact={selected} />
              <p className="text-sm text-muted-foreground">{selected.summary}</p>
              <div className="flex flex-wrap gap-1.5">
                {selected.snippet && (
                  <Button variant="outline" size="xs" onClick={() => onInsert(selected)}>
                    {t(($) => $.notes.artifacts.insert)}
                  </Button>
                )}
                <Button variant="outline" size="xs" onClick={() => onNewProject(selected)}>
                  {t(($) => $.notes.artifacts.newProject)}
                </Button>
              </div>
            </section>
          )}
        </div>
      )}
    </aside>
  );
}
