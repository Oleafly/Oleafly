import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { CodeBlock } from "@/components/ui/code-block";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip } from "@/components/ui/tooltip";
import { formatRelativeTimeFrom } from "@/lib/intl";
import { cn } from "@/lib/utils";
import { artifactsForNote } from "./note-artifacts";
import { AgentTag, KindBadge, KindChip } from "./note-icons";
import { useNotesData } from "./notes-data";
import type { ArtifactItem, ArtifactPreview, NoteItem } from "./types";

interface ArtifactPanelProps {
  note: NoteItem;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onInsert?: (artifact: ArtifactItem) => Promise<void>;
  onNewProject?: (artifact: ArtifactItem) => void;
}

type PreviewState =
  | { status: "loading" }
  | { status: "ready"; preview: ArtifactPreview }
  | { status: "failed"; error: string };

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function usePreview(artifact: ArtifactItem): PreviewState | null {
  const { previewArtifact } = useNotesData();
  const [state, setState] = useState<{ key: string; value: PreviewState } | null>(null);
  const artifactRef = useRef(artifact);
  artifactRef.current = artifact;
  const key = `${artifact.id}\n${artifact.updatedAt}`;

  useEffect(() => {
    if (!previewArtifact) return;
    let live = true;
    setState({ key, value: { status: "loading" } });
    previewArtifact(artifactRef.current).then(
      (preview) => live && setState({ key, value: { status: "ready", preview } }),
      (error: unknown) => live && setState({ key, value: { status: "failed", error: errorText(error) } }),
    );
    return () => {
      live = false;
    };
  }, [key, previewArtifact]);

  if (!previewArtifact) return null;
  return state?.key === key ? state.value : { status: "loading" };
}

interface KeyedRow {
  id: string;
  cells: { id: string; value: string }[];
}

function keyedRows(rows: readonly (readonly string[])[]): KeyedRow[] {
  return rows.map((cells, row) => ({
    id: `row-${String(row)}`,
    cells: cells.map((value, column) => ({ id: `cell-${String(column)}`, value })),
  }));
}

function PreviewBody({ preview, title }: Readonly<{ preview: ArtifactPreview; title: string }>) {
  const { t } = useTranslation(["notes"]);
  const note = (text: string) => <p className="rounded-md border bg-muted/50 p-3 text-xs text-muted-foreground">{text}</p>;
  const truncated = (shown: boolean) =>
    shown && <p className="text-xs text-muted-foreground">{t(($) => $.notes.artifacts.truncated)}</p>;
  if (preview.type === "image") {
    return <img src={preview.src} alt={title} className="w-full rounded-md border bg-background" />;
  }
  if (preview.type === "table") {
    const [head = { id: "head", cells: [] }, ...body] = keyedRows(preview.rows);
    return (
      <div className="space-y-1">
        <div className="max-h-72 overflow-auto rounded-md border">
          <table className="w-full text-left text-xs tabular-nums">
            <thead className="bg-muted/50">
              <tr>
                {head.cells.map((cell) => (
                  <th key={cell.id} scope="col" className="whitespace-nowrap px-2 py-1 font-medium">
                    {cell.value}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {body.map((row) => (
                <tr key={row.id} className="border-t">
                  {row.cells.map((cell) => (
                    <td key={cell.id} className="whitespace-nowrap px-2 py-1">
                      {cell.value}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {truncated(preview.truncated)}
      </div>
    );
  }
  if (preview.type === "text") {
    return (
      <div className="space-y-1">
        <CodeBlock code={preview.text} preClassName="max-h-72 whitespace-pre-wrap break-words" />
        {truncated(preview.truncated)}
      </div>
    );
  }
  if (preview.reason === "html") return note(t(($) => $.notes.artifacts.htmlPreview));
  if (preview.reason === "missing") return note(t(($) => $.notes.artifacts.missing));
  return note(t(($) => $.notes.artifacts.binary));
}

function Preview({ artifact }: Readonly<{ artifact: ArtifactItem }>) {
  const { t } = useTranslation(["notes"]);
  const state = usePreview(artifact);
  if (!state) return null;
  if (state.status === "loading") {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Spinner size="sm" />
        {t(($) => $.notes.artifacts.loading)}
      </div>
    );
  }
  if (state.status === "failed") {
    return (
      <p className="text-xs text-destructive">{t(($) => $.notes.artifacts.previewFailed, { error: state.error })}</p>
    );
  }
  return <PreviewBody preview={state.preview} title={artifact.title} />;
}

function InsertButton({ artifact, onInsert }: Readonly<{ artifact: ArtifactItem; onInsert: (artifact: ArtifactItem) => Promise<void> }>) {
  const { t } = useTranslation(["notes"]);
  const [state, setState] = useState<{ id: string; busy: boolean; error: string | null }>({
    id: artifact.id,
    busy: false,
    error: null,
  });
  const current = state.id === artifact.id ? state : { id: artifact.id, busy: false, error: null };
  const insert = () => {
    setState({ id: artifact.id, busy: true, error: null });
    onInsert(artifact).then(
      () => setState((previous) => (previous.id === artifact.id ? { ...previous, busy: false } : previous)),
      (error: unknown) =>
        setState((previous) =>
          previous.id === artifact.id ? { id: artifact.id, busy: false, error: errorText(error) } : previous,
        ),
    );
  };
  return (
    <>
      <Button variant="outline" size="xs" disabled={current.busy} onClick={insert}>
        {current.busy ? t(($) => $.notes.artifacts.inserting) : t(($) => $.notes.artifacts.insert)}
      </Button>
      {current.error && (
        <p role="alert" className="w-full text-xs text-destructive">
          {t(($) => $.notes.artifacts.insertFailed, { error: current.error })}
        </p>
      )}
    </>
  );
}

export function ArtifactPanel({ note, selectedId, onSelect, onInsert, onNewProject }: Readonly<ArtifactPanelProps>) {
  const { t } = useTranslation(["notes"]);
  const data = useNotesData();
  const artifacts = artifactsForNote(data.artifacts, note);
  const selected = artifacts.find((artifact) => artifact.id === selectedId) ?? artifacts[0] ?? null;
  const empty = note.relatedProjectId
    ? t(($) => $.notes.artifacts.empty, { project: note.project })
    : t(($) => $.notes.artifacts.noProject);

  return (
    <aside aria-label={t(($) => $.notes.artifacts.title)} className="flex h-full w-full min-w-0 flex-col bg-background">
      {artifacts.length === 0 ? (
        <p className="p-4 text-sm text-muted-foreground">{empty}</p>
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
                    "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent focus-visible:bg-accent",
                    selected?.id === artifact.id && "bg-primary/10 font-medium hover:bg-primary/15 focus-visible:bg-primary/15",
                  )}
                >
                  <KindChip kind={artifact.kind} />
                  <span className="truncate">{artifact.title}</span>
                </button>
              </li>
            ))}
          </ul>
          {selected && (
            <section className="space-y-3 border-t p-3">
              <header className="space-y-1.5">
                <div className="flex items-start gap-2.5">
                  <KindChip kind={selected.kind} className="size-8 rounded-lg [&_svg]:size-4" />
                  <div className="min-w-0 flex-1 space-y-1">
                    <h3 className="text-sm font-medium">{selected.title}</h3>
                    <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                      <KindBadge kind={selected.kind} label={t(($) => $.notes.artifacts.kind[selected.kind])} />{" "}
                      <AgentTag name={selected.agent ?? t(($) => $.notes.library.agentFallback)} />{" "}
                      <span>{`· ${formatRelativeTimeFrom(selected.updatedAt, Date.now(), { dateAfterDays: 7 })}`}</span>
                    </div>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">{t(($) => $.notes.artifacts.fromTask, { task: selected.chat })}</p>
                <Tooltip label={selected.path} wide className="flex min-w-0 max-w-full">
                  <span className="block truncate font-mono text-xs text-muted-foreground">{selected.path}</span>
                </Tooltip>
              </header>
              <Preview key={selected.id} artifact={selected} />
              {selected.summary && <p className="line-clamp-6 text-sm text-muted-foreground">{selected.summary}</p>}
              {(onInsert || onNewProject) && (
                <div className="flex flex-wrap gap-1.5">
                  {onInsert && <InsertButton artifact={selected} onInsert={onInsert} />}
                  {onNewProject && (
                    <Button variant="outline" size="xs" onClick={() => onNewProject(selected)}>
                      {t(($) => $.notes.artifacts.newProject)}
                    </Button>
                  )}
                </div>
              )}
            </section>
          )}
        </div>
      )}
    </aside>
  );
}
