import { useMemo, useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
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
    <li className={cn("font-mono text-xs", tone)} data-testid={`clean-action-${action.kind}`}>
      {text}
    </li>
  );
}

/** Tiny line diff: removed lines red, added lines green, context dimmed. */
function DiffView({ outcome }: { outcome: CleanLibraryOutcome }) {
  const before = outcome.original.split("\n");
  const after = outcome.cleaned.split("\n");
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
      className="max-h-72 overflow-auto rounded-lg border bg-muted/30 p-2 font-mono text-[11px] leading-5"
    >
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

  const bibFiles = useMemo(
    () => tree.filter((entry) => !entry.is_dir && entry.path.endsWith(".bib")).map((entry) => entry.path),
    [tree],
  );

  const target =
    bibPath
      ?? selectCitationBibliography(
          engineProfile,
          files[resolveEffectiveMainDoc().mainDoc]?.content ?? "",
          bibFiles,
        );

  const run = async (apply: boolean) => {
    if (!projectId || !target) return;
    setBusy(true);
    try {
      const result = await cleanBibtexLibrary(projectId, target, apply);
      setOutcome(result);
      if (apply) {
        toast.success(
          `Library cleaned · ${result.entriesAfter} of ${result.entriesBefore} entries kept`,
        );
        const store = useFilesStore.getState();
        await store.refreshTree();
        onClose();
      }
    } catch (e) {
      notifyError("clean library", e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (!next ? onClose() : undefined)}>
      <DialogContent data-testid="clean-library-dialog" className="max-w-2xl gap-4">
        <DialogHeader>
          <DialogTitle>Clean the reference library</DialogTitle>
          <DialogDescription>
            Renames keys to the firstauthorYEARfirstword scheme, removes DOI
            and fuzzy-title duplicates, and rewrites citations of renamed keys
            across the project. Nothing changes until you apply the plan.
          </DialogDescription>
        </DialogHeader>

        {bibFiles.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            This project has no .bib file to clean.
          </p>
        ) : (
          <>
            {bibFiles.length > 1 ? (
              <div className="flex flex-wrap gap-1">
                {bibFiles.map((path) => (
                  <button
                    key={path}
                    type="button"
                    onClick={() => setBibPath(path)}
                    className={cn(
                      "rounded-md border px-2 py-1 font-mono text-[11px] transition-colors",
                      path === target
                        ? "border-primary/50 bg-primary/10 text-primary"
                        : "text-muted-foreground hover:bg-accent",
                    )}
                  >
                    {path}
                  </button>
                ))}
              </div>
            ) : null}

            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                data-testid="clean-library-dry-run"
                disabled={busy}
                onClick={() => void run(false)}
              >
                {busy && !outcome ? <Loader2 aria-hidden className="size-3.5 animate-spin" /> : null}
                {outcome ? "Re-run plan" : "Preview changes"}
              </Button>
              <span className="text-xs text-muted-foreground" data-testid="clean-library-target">
                {target}
              </span>
            </div>

            {outcome ? (
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  {outcome.entriesBefore} entries today, {outcome.entriesAfter} after
                  cleaning · {outcome.actions.length} planned actions
                </p>
                <ul className="max-h-40 space-y-1 overflow-auto rounded-lg border p-2" data-testid="clean-library-actions">
                  {outcome.actions.map((action, index) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: static plan rows
                    <ActionRow key={index} action={action} />
                  ))}
                  {outcome.actions.length === 0 ? (
                    <li className="text-xs text-muted-foreground">
                      Nothing to change. The library is already clean.
                    </li>
                  ) : null}
                </ul>
                <DiffView outcome={outcome} />
                <div className="flex justify-end gap-2">
                  <Button
                    type="button"
                    size="sm"
                    data-testid="clean-library-apply"
                    disabled={busy || outcome.actions.length === 0}
                    onClick={() => void run(true)}
                  >
                    <Sparkles aria-hidden className="size-3.5" />
                    Apply and rewrite citations
                  </Button>
                </div>
              </div>
            ) : null}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
