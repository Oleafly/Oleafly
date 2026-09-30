import { useEffect, useId } from "react";
import { ChevronRight, FileDiff } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { i18n } from "@/i18n";
import type { TurnChange, TurnFileState, TurnUnavailable } from "@/lib/agent-turns";
import { cn } from "@/lib/utils";
import type { ChatTurnChanges } from "@/store/chats";
import { DiffPreview } from "./DiffPreview";
import {
  turnReviewFor,
  useTurnReviewStore,
  type TurnAction,
  type TurnOutcome,
  type TurnReview,
} from "./turn-review-store";
import { useProjectAgentBusy } from "./use-project-agent-busy";

export function turnUnavailableText(reason: TurnUnavailable): string {
  switch (reason) {
    case "too_large":
      return i18n.t(($) => $.ai.turnChanges.unavailable.tooLarge);
    case "too_many_files":
      return i18n.t(($) => $.ai.turnChanges.unavailable.tooManyFiles);
    case "timeout":
      return i18n.t(($) => $.ai.turnChanges.unavailable.timeout);
    default:
      return i18n.t(($) => $.ai.turnChanges.unavailable.error);
  }
}

function changeKindText(change: TurnChange["change"]): string {
  if (change === "added") return i18n.t(($) => $.ai.turnChanges.kind.added);
  if (change === "deleted") return i18n.t(($) => $.ai.turnChanges.kind.deleted);
  return i18n.t(($) => $.ai.turnChanges.kind.modified);
}

function outcomeText(outcome: TurnOutcome | null): string {
  if (!outcome || outcome.failed) return "";
  const parts: string[] = [];
  if (outcome.done > 0) {
    parts.push(
      outcome.action === "undo"
        ? i18n.t(($) => $.ai.turnChanges.undid, { count: outcome.done })
        : i18n.t(($) => $.ai.turnChanges.redid, { count: outcome.done }),
    );
  }
  if (outcome.edited) parts.push(i18n.t(($) => $.ai.turnChanges.skippedEdited));
  if (outcome.failedWrites) parts.push(i18n.t(($) => $.ai.turnChanges.skippedFailed));
  return parts.join(" ");
}

function LineCounts({ added, removed }: Readonly<{ added: number; removed: number }>) {
  return (
    <span className="shrink-0 tabular-nums">
      <span className="text-emerald-600 dark:text-emerald-400">+{added}</span>{" "}
      <span className="text-destructive">-{removed}</span>
    </span>
  );
}

function lineTotals(files: readonly TurnChange[]): { added: number; removed: number } | null {
  const counted = files.filter((file) => file.added !== null || file.removed !== null);
  if (counted.length === 0) return null;
  return counted.reduce(
    (sum, file) => ({ added: sum.added + (file.added ?? 0), removed: sum.removed + (file.removed ?? 0) }),
    { added: 0, removed: 0 },
  );
}

interface HeaderAction {
  action: TurnAction;
  indices: number[] | null;
}

/**
 * Undo all covers every changed source file except files the user also edited,
 * files the assistant committed and files already changed again. `null` asks
 * the backend for all of them, including files beyond the listed ones
 * (`moreFiles`), which no row can reach. The backend skips files the user also
 * edited, counts files already in the target state as done and leaves files
 * changed again alone, so `null` is safe in both directions as long as nothing
 * was committed. With committed files only the listed, uncommitted ones go.
 */
function headerActionFor(
  changes: ChatTurnChanges,
  source: readonly TurnChange[],
  states: Readonly<Record<number, TurnFileState>>,
  undoable: boolean,
): HeaderAction | null {
  if (!undoable || changes.overlapped) return null;
  const stateOf = (file: TurnChange): TurnFileState => states[file.index] ?? "applied";
  const committed = changes.committed ?? {};
  const eligible = source.filter(
    (file) => !file.alsoEditedHere && !committed[file.path] && stateOf(file) !== "edited",
  );
  const toUndo = eligible.filter((file) => stateOf(file) === "applied");
  const toRedo = eligible.filter((file) => stateOf(file) === "undone");
  const anyCommitted = Object.keys(committed).length > 0;
  if (changes.moreFiles > 0 && !anyCommitted) {
    // Unlisted files have no status row; Undo and Redo report them by index.
    const listed = new Set(changes.files.map((file) => file.index));
    const unlistedUndone = Object.entries(states).some(
      ([index, state]) => state === "undone" && !listed.has(Number(index)),
    );
    if (toUndo.length === 0 && (toRedo.length > 0 || unlistedUndone)) {
      return { action: "redo", indices: null };
    }
    return { action: "undo", indices: null };
  }
  const anyUndone = source.some((file) => stateOf(file) === "undone");
  if (toUndo.length > 0) {
    return {
      action: "undo",
      indices: anyUndone || anyCommitted ? toUndo.map((file) => file.index) : null,
    };
  }
  if (toRedo.length > 0) return { action: "redo", indices: toRedo.map((file) => file.index) };
  return null;
}

function PreviewBody({ file, review }: Readonly<{ file: TurnChange; review: TurnReview }>) {
  const { t } = useTranslation(["common", "ai"]);
  const preview = review.previews[file.index];
  if (review.previewFailed === file.index) {
    return (
      <p role="alert" className="text-[11px] text-destructive">
        {t(($) => $.ai.turnChanges.previewFailed)}
      </p>
    );
  }
  if (!preview) return <p className="text-[11px]">{t(($) => $.ai.turnChanges.previewLoading)}</p>;
  if (preview.binary) return <p className="text-[11px]">{t(($) => $.ai.turnChanges.binary)}</p>;
  if (preview.tooLarge) return <p className="text-[11px]">{t(($) => $.ai.turnChanges.tooLarge)}</p>;
  return (
    <DiffPreview
      path={preview.path}
      oldText={preview.before ?? ""}
      newText={preview.after ?? ""}
      label={t(($) => $.ai.turnChanges.diffLabel, { path: preview.path })}
      loadingLabel={t(($) => $.ai.turnChanges.previewLoading)}
    />
  );
}

function FileRow({
  file,
  projectId,
  snapshotId,
  review,
  state,
  commit,
  undoable,
  busy,
}: Readonly<{
  file: TurnChange;
  projectId: string;
  snapshotId: string | null;
  review: TurnReview;
  state: TurnFileState;
  commit: string | undefined;
  undoable: boolean;
  busy: boolean;
}>) {
  const { t } = useTranslation(["common", "ai"]);
  const panelId = useId();
  const togglePreview = useTurnReviewStore((store) => store.togglePreview);
  const run = useTurnReviewStore((store) => store.run);
  const open = review.open === file.index;
  const previewable = !!snapshotId && undoable;
  const action: TurnAction | null =
    !undoable || commit || state === "edited" ? null : state === "undone" ? "redo" : "undo";
  const pendingHere = review.pending === file.index;
  const blocked = busy || (review.pending !== null && !pendingHere);
  const path = file.path;
  return (
    <li className="py-1">
      <div className="flex min-w-0 items-center gap-2">
        {previewable ? (
          <button
            type="button"
            aria-expanded={open}
            aria-controls={panelId}
            onClick={() => {
              if (snapshotId) void togglePreview(projectId, snapshotId, file.index);
            }}
            className="flex min-w-0 flex-1 items-center gap-1.5 rounded px-1 py-0.5 text-left text-foreground transition-colors hover:bg-accent focus-visible:bg-accent"
          >
            <ChevronRight
              aria-hidden
              className={cn("size-3 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")}
            />
            <span className="min-w-0 flex-1 truncate font-mono">{path}</span>
          </button>
        ) : (
          <span className="min-w-0 flex-1 truncate px-1 font-mono text-foreground">{path}</span>
        )}
        <span className="shrink-0">{changeKindText(file.change)}</span>
        {file.added !== null || file.removed !== null ? (
          <LineCounts added={file.added ?? 0} removed={file.removed ?? 0} />
        ) : null}
        {commit ? (
          <span className="shrink-0">
            {t(($) => $.ai.turnChanges.committed, { commit: commit.slice(0, 7) })}
          </span>
        ) : null}
        {!commit && state === "undone" ? <span className="shrink-0">{t(($) => $.ai.turnChanges.undone)}</span> : null}
        {!commit && state === "edited" ? (
          <span className="shrink-0">{t(($) => $.ai.turnChanges.editedAfter)}</span>
        ) : null}
        {action ? (
          <Button
            type="button"
            variant="outline"
            size="xs"
            disabled={blocked}
            aria-busy={pendingHere || undefined}
            aria-disabled={pendingHere || undefined}
            title={busy ? t(($) => $.ai.turnChanges.waitForRun) : undefined}
            aria-label={
              action === "undo"
                ? t(($) => $.ai.turnChanges.undoFile, { path })
                : t(($) => $.ai.turnChanges.redoFile, { path })
            }
            onClick={() => {
              if (!snapshotId || pendingHere) return;
              void run(projectId, snapshotId, action, [file.index], file.index);
            }}
          >
            {action === "undo" ? t(($) => $.ai.turnChanges.undo) : t(($) => $.ai.turnChanges.redo)}
          </Button>
        ) : null}
      </div>
      {file.alsoEditedHere ? (
        <p className="pl-6 text-[10px] text-amber-700 dark:text-amber-300">
          {t(($) => $.ai.turnChanges.alsoEdited)}
        </p>
      ) : null}
      {open ? (
        <div id={panelId} className="mt-1.5">
          <PreviewBody file={file} review={review} />
        </div>
      ) : null}
    </li>
  );
}

/**
 * "Changed N files · Review · Undo all" under the turn that changed them, for
 * both the built-in assistant and CLI agents. Every Undo or Redo goes through
 * the project transaction so open editors reload and unsaved edits are saved
 * first. The card never calls these copies anything but Undo and Redo.
 */
export function TurnChangesCard({
  projectId,
  changes,
  showUnavailable = false,
  className,
}: Readonly<{
  projectId: string;
  changes: ChatTurnChanges;
  /** Show the "Undo isn't available" line (hosts pass it once per session). */
  showUnavailable?: boolean;
  className?: string;
}>) {
  const { t } = useTranslation(["common", "ai"]);
  const snapshotId = changes.snapshotId;
  const localKey = useId();
  const reviewKey = snapshotId ?? `local${localKey}`;
  const review = useTurnReviewStore((store) => turnReviewFor(store.reviews, reviewKey));
  const loadStatus = useTurnReviewStore((store) => store.loadStatus);
  const toggleExpanded = useTurnReviewStore((store) => store.toggleExpanded);
  const toggleBuild = useTurnReviewStore((store) => store.toggleBuild);
  const run = useTurnReviewStore((store) => store.run);
  const busy = useProjectAgentBusy(projectId);
  const listId = useId();
  const buildId = useId();
  const hasFiles = changes.files.length + changes.moreFiles > 0;
  const undoable = !!snapshotId && !changes.unavailable && !review.expired;

  useEffect(() => {
    if (hasFiles && snapshotId && !changes.unavailable) void loadStatus(projectId, snapshotId);
  }, [changes.unavailable, hasFiles, loadStatus, projectId, snapshotId]);

  if (!hasFiles) {
    return showUnavailable && changes.unavailable ? (
      <p data-testid="turn-changes-unavailable" className={cn("px-1 text-[11px] text-muted-foreground", className)}>
        {turnUnavailableText(changes.unavailable)}
      </p>
    ) : null;
  }

  const source = changes.files.filter((file) => !file.build);
  const build = changes.files.filter((file) => file.build);
  const total = source.length + changes.moreFiles;
  const committed = changes.committed ?? {};
  const stateOf = (file: TurnChange): TurnFileState => review.states[file.index] ?? "applied";
  const header = headerActionFor(changes, source, review.states, undoable);
  const totals = lineTotals(source);
  const status = outcomeText(review.outcome);
  const failed = review.outcome?.failed ? review.outcome.action : null;
  const pendingAll = review.pending === "all";

  return (
    <fieldset
      data-testid="turn-changes"
      data-tour="ai-turn-changes"
      aria-label={t(($) => $.ai.turnChanges.ariaLabel)}
      className={cn("min-w-0 rounded-md border bg-muted/40 px-2.5 py-1.5 text-[11px] text-muted-foreground", className)}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <FileDiff aria-hidden className="size-3.5 shrink-0" />
        <span className="font-medium text-foreground">
          {total > 0
            ? t(($) => $.ai.turnChanges.changed, { count: total })
            : t(($) => $.ai.turnChanges.buildOnly)}
        </span>
        {totals ? <LineCounts added={totals.added} removed={totals.removed} /> : null}
        <span className="ml-auto flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="xs"
            aria-expanded={review.expanded}
            aria-controls={listId}
            onClick={() => {
              if (!review.expanded && undoable && snapshotId) void loadStatus(projectId, snapshotId, true);
              toggleExpanded(reviewKey);
            }}
          >
            {t(($) => $.ai.turnChanges.review)}
          </Button>
          {header ? (
            <Button
              type="button"
              variant="outline"
              size="xs"
              disabled={busy || (review.pending !== null && !pendingAll)}
              aria-busy={pendingAll || undefined}
              aria-disabled={pendingAll || undefined}
              title={busy ? t(($) => $.ai.turnChanges.waitForRun) : undefined}
              onClick={() => {
                if (!snapshotId || pendingAll) return;
                void run(projectId, snapshotId, header.action, header.indices, "all");
              }}
            >
              {header.action === "undo"
                ? t(($) => $.ai.turnChanges.undoAll)
                : t(($) => $.ai.turnChanges.redoAll)}
            </Button>
          ) : null}
        </span>
      </div>
      {showUnavailable && changes.unavailable ? <p className="mt-1">{turnUnavailableText(changes.unavailable)}</p> : null}
      {snapshotId && review.expired ? <p className="mt-1">{t(($) => $.ai.turnChanges.expired)}</p> : null}
      {undoable && changes.overlapped ? <p className="mt-1">{t(($) => $.ai.turnChanges.overlapped)}</p> : null}
      {review.expanded ? (
        <div id={listId} className="mt-1.5 space-y-1.5">
          {source.length > 0 ? (
            <ul className="divide-y divide-border/60">
              {source.map((file) => (
                <FileRow
                  key={file.index}
                  file={file}
                  projectId={projectId}
                  snapshotId={snapshotId}
                  review={review}
                  state={stateOf(file)}
                  commit={committed[file.path]}
                  undoable={undoable}
                  busy={busy}
                />
              ))}
            </ul>
          ) : null}
          {changes.moreFiles > 0 ? (
            <p>{t(($) => $.ai.turnChanges.moreFiles, { count: changes.moreFiles })}</p>
          ) : null}
          {changes.skipped.length > 0 ? (
            <p>{t(($) => $.ai.turnChanges.skipped, { count: changes.skipped.length })}</p>
          ) : null}
          {build.length > 0 ? (
            <div>
              <button
                type="button"
                aria-expanded={review.buildExpanded}
                aria-controls={buildId}
                onClick={() => toggleBuild(reviewKey)}
                className="flex items-center gap-1.5 rounded px-1 py-0.5 transition-colors hover:bg-accent focus-visible:bg-accent"
              >
                <ChevronRight
                  aria-hidden
                  className={cn("size-3 shrink-0 transition-transform", review.buildExpanded && "rotate-90")}
                />
                {t(($) => $.ai.turnChanges.buildFiles)}
              </button>
              {review.buildExpanded ? (
                <ul id={buildId} className="pl-6">
                  {build.map((file) => (
                    <li key={file.index} className="truncate font-mono">
                      {file.path}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
      <p role="status" className={cn(status ? "mt-1" : "sr-only")}>
        {status}
      </p>
      {failed ? (
        <p role="alert" className="mt-1 text-destructive">
          {failed === "undo" ? t(($) => $.ai.turnChanges.undoFailed) : t(($) => $.ai.turnChanges.redoFailed)}
        </p>
      ) : null}
    </fieldset>
  );
}
