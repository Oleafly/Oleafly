import { useEffect, useMemo, useRef, useState } from "react";
import { BookOpenCheck, FileDiff, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  cleanBibtexLibrary,
  type CleanAction,
  type CleanLibraryOutcome,
} from "@/lib/tauri";
import { selectCitationBibliography } from "@/features/citation";
import { resolveEffectiveMainDoc } from "@/lib/tex-root";
import { useFilesStore } from "@/store/files";
import { notifyError, toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { ToolPane, ToolPreviewSurface, ToolSplitView, ToolStatus } from "@/components/tools/ToolWorkspace";

function ActionRow({ action }: { action: CleanAction }) {
  const text = (() => {
    switch (action.kind) {
      case "renamed-key":
        return `${action.old} renamed to ${action.new}`;
      case "removed-duplicate":
        return `${action.removed} removed as a duplicate of ${action.kept} (matched by ${action.by})`;
      default:
        return action.field
          ? `${action.key || "Library"}: ${action.field}`
          : action.key ?? "";
    }
  })();
  const tone =
    action.kind === "removed-duplicate"
      ? "text-amber-700 dark:text-amber-300"
      : action.kind === "renamed-key"
        ? "text-blue-700 dark:text-blue-300"
        : "text-muted-foreground";
  return (
    <li className={cn("text-xs leading-relaxed", tone)} data-testid={`clean-action-${action.kind}`}>
      {text}
    </li>
  );
}

/** Tiny line diff: removed lines red, added lines green, context dimmed. */
function DiffView({ outcome }: { outcome: CleanLibraryOutcome }) {
  const before = outcome.original.split("\n", 501);
  const after = outcome.cleaned.split("\n", 501);
  const truncated = before.length > 500 || after.length > 500;
  before.length = Math.min(before.length, 500);
  after.length = Math.min(after.length, 500);
  const afterSet = new Map<string, number>();
  for (const line of after) afterSet.set(line, (afterSet.get(line) ?? 0) + 1);
  const beforeSet = new Map<string, number>();
  for (const line of before) beforeSet.set(line, (beforeSet.get(line) ?? 0) + 1);
  const rows: { kind: "same" | "add" | "del"; line: string }[] = [];
  for (const line of before) {
    const count = afterSet.get(line) ?? 0;
    if (count > 0) {
      afterSet.set(line, count - 1);
      rows.push({ kind: "same", line });
    } else {
      rows.push({ kind: "del", line });
    }
  }
  for (const line of after) {
    const count = beforeSet.get(line) ?? 0;
    if (count > 0) {
      beforeSet.set(line, count - 1);
    } else {
      rows.push({ kind: "add", line });
    }
  }
  return (
    <div
      data-testid="clean-library-diff"
      className="min-h-0 flex-1 overflow-auto p-4 font-mono text-[11px] leading-5"
    >
      {truncated ? <p className="mb-2 text-muted-foreground">Preview shows the first 500 lines of each version.</p> : null}
      {rows.map((row, index) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: static diff rows have no identity
          key={index}
          className={cn(
            "whitespace-pre-wrap",
            row.kind === "add" && "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
            row.kind === "del" && "bg-red-500/10 text-red-700 dark:text-red-300 line-through",
            row.kind === "same" && "text-muted-foreground",
          )}
        >
          {row.kind === "add" ? "+ " : row.kind === "del" ? "- " : "  "}
          {row.line || " "}
        </div>
      ))}
    </div>
  );
}

export function CleanLibraryDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const projectId = useFilesStore((s) => s.projectId);
  const files = useFilesStore((s) => s.files);
  const tree = useFilesStore((s) => s.tree);
  const engineProfile = useFilesStore((s) => s.engine.capabilities.formatting_profile);
  const [bibPath, setBibPath] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<CleanLibraryOutcome | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  const bibFiles = useMemo(
    () => tree.filter((entry) => !entry.is_dir && entry.path.endsWith(".bib")).map((entry) => entry.path),
    [tree],
  );

  const target =
    (bibPath && bibFiles.includes(bibPath) ? bibPath : null)
      ?? selectCitationBibliography(
          engineProfile,
          files[resolveEffectiveMainDoc().mainDoc]?.content ?? "",
          bibFiles,
        );

  // biome-ignore lint/correctness/useExhaustiveDependencies: a preview belongs to this open project and library
  useEffect(() => {
    requestId.current += 1;
    setOutcome(null);
    setError(null);
    setBusy(false);
  }, [projectId, target, open]);

  const run = async (apply: boolean) => {
    if (!projectId || !target || busy || (apply && !outcome)) return;
    const request = ++requestId.current;
    setBusy(true);
    setError(null);
    if (!apply) setOutcome(null);
    try {
      const store = useFilesStore.getState();
      if (!apply) {
        await store.flushForQuit();
        if (request !== requestId.current || useFilesStore.getState().projectId !== projectId) return;
      }
      const result = apply
        ? await store.runExternalProjectMutation(projectId, async (generation) => {
            const result = await cleanBibtexLibrary(projectId, target, true, outcome?.previewToken, generation);
            if (!result.projectState) throw new Error("The cleaned files could not be reloaded. Reopen the project before editing.");
            return { ...result, projectState: result.projectState };
          })
        : await cleanBibtexLibrary(projectId, target, false);
      if (request !== requestId.current || useFilesStore.getState().projectId !== projectId) return;
      setOutcome(result);
      if (apply) {
        toast.success(`Library cleaned. ${result.entriesAfter} of ${result.entriesBefore} entries kept.${result.backupPath ? ` Original files are saved in ${result.backupPath}.` : ""}`);
        onClose();
      }
    } catch (e) {
      if (request === requestId.current) {
        setOutcome(null);
        setError(e instanceof Error ? e.message : String(e));
        notifyError("clean library", e);
      }
    } finally {
      if (request === requestId.current) setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (!next && !busy ? onClose() : undefined)}>
      <DialogContent data-testid="clean-library-dialog" closeDisabled={busy} className="flex h-[min(44rem,85dvh)] max-w-5xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 border-b px-5 py-4 pr-12">
          <div className="flex items-center gap-3">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-md border bg-muted"><BookOpenCheck aria-hidden className="size-4" /></div>
            <div className="space-y-1">
              <DialogTitle className="text-sm leading-tight">Clean the reference library</DialogTitle>
              <DialogDescription className="text-xs">Review citation keys and duplicate entries before changing your files.</DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <ToolSplitView>
          <ToolPane title="Reference library" badge={outcome ? `${outcome.entriesBefore} entries` : undefined}
            footer={<p className="text-xs leading-relaxed text-muted-foreground">Preview saves your open files. Applying checks that they still match the preview and backs up the originals.</p>}
          >
            <div className="space-y-5 p-5">
              {bibFiles.length === 0 ? <p className="text-sm text-muted-foreground">This project has no .bib file to clean.</p> : <>
                {bibFiles.length > 1 && <div className="flex flex-wrap gap-1.5">{bibFiles.map((path) => (
                  <button key={path} type="button" disabled={busy} aria-pressed={path === target} onClick={() => setBibPath(path)} className={cn("max-w-full truncate rounded-full border px-3 py-1.5 font-mono text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", path === target ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-accent")}>{path}</button>
                ))}</div>}
                <p className="break-all font-mono text-xs text-muted-foreground" data-testid="clean-library-target">{target}</p>
                {outcome ? <div className="space-y-4">
                  <p className="text-sm">{outcome.entriesAfter} of {outcome.entriesBefore} entries will remain.</p>
                  <div className="space-y-2">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Changes and notes</h3>
                    <ul className="space-y-3" data-testid="clean-library-actions">
                      {outcome.actions.map((action, index) => (
                        // biome-ignore lint/suspicious/noArrayIndexKey: static preview rows
                        <ActionRow key={index} action={action} />
                      ))}
                      {outcome.changedFiles.length === 0 && <li className="text-xs text-muted-foreground">No file changes to apply.</li>}
                    </ul>
                  </div>
                  <p className="break-words text-xs leading-relaxed text-muted-foreground">Files to update: {outcome.changedFiles.join(", ") || "None"}</p>
                </div> : <div className="space-y-3 text-sm leading-relaxed text-muted-foreground">
                  <p>Citation keys are standardized. DOI duplicates are removed only when all their details can be preserved.</p>
                  <p>Similar titles and conflicting metadata stay in the library for review.</p>
                </div>}
              </>}
              {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            </div>
          </ToolPane>
          <ToolPane title="Preview" badge={outcome ? "Changes" : undefined}>
            <ToolPreviewSurface className={outcome ? "min-h-0 p-0 md:p-0" : "items-center justify-center"}>
              {outcome ? <DiffView outcome={outcome} /> : <div className="max-w-xs space-y-2 text-center">
                <FileDiff aria-hidden className="mx-auto mb-4 size-8 text-muted-foreground/60" />
                <p className="text-sm font-medium">Review before applying</p>
                <p className="text-xs leading-relaxed text-muted-foreground">Preview the changes to see which entries and citations will be updated.</p>
              </div>}
            </ToolPreviewSurface>
          </ToolPane>
        </ToolSplitView>
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t px-5 py-3">
          <ToolStatus state={error ? "error" : busy ? "busy" : "ready"}>{error ? "Needs attention" : busy ? "Working…" : outcome ? "Preview ready" : "Ready to preview"}</ToolStatus>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" variant="outline" data-testid="clean-library-dry-run" disabled={busy || !target} onClick={() => void run(false)}>
              {busy && !outcome && <Loader2 aria-hidden className="size-3.5 animate-spin" />}
              {outcome ? "Refresh preview" : "Preview changes"}
            </Button>
            {outcome && <Button type="button" size="sm" data-testid="clean-library-apply" disabled={busy || outcome.changedFiles.length === 0} onClick={() => void run(true)}><Sparkles aria-hidden className="size-3.5" /> Apply and rewrite citations</Button>}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
