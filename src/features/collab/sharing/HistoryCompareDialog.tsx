import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight, X } from "lucide-react";
import { DiffPreview } from "@/components/ai/turns/DiffPreview";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ModalShell } from "@/components/ui/modal-shell";
import { formatNumber } from "@/lib/intl";
import { logError } from "@/lib/log";
import type { CollabFileAtVersion, CollabHistoryEntry } from "@/lib/tauri";
import { collabHistoryChangedFiles, collabHistoryFile } from "@/lib/tauri-collab";
import { cn } from "@/lib/utils";
import { collabErrorText } from "../errors";
import { InlineAlert } from "../feedback";
import { historyEntryTitle } from "./HistoryVersionDialog";
import { MAX_OPEN_DIFFS } from "./MergeReviewDialog";

type Listed = { state: "loading" } | { state: "failed"; reason: string } | { state: "ready"; paths: string[] };

type FilePair =
  | { state: "loading" }
  | { state: "failed"; reason: string }
  | { state: "ready"; before: CollabFileAtVersion; after: CollabFileAtVersion };

function FileDiff({
  projectId,
  from,
  to,
  path,
  id,
}: Readonly<{ projectId: string; from: string; to: string; path: string; id: string }>) {
  const { t } = useTranslation(["collab"]);
  const [pair, setPair] = useState<FilePair>({ state: "loading" });
  useEffect(() => {
    let current = true;
    setPair({ state: "loading" });
    Promise.all([collabHistoryFile(projectId, from, path), collabHistoryFile(projectId, to, path)]).then(
      ([before, after]) => {
        if (current) setPair({ state: "ready", before, after });
      },
      (error: unknown) => {
        void logError("collab history compare file", error);
        if (current) setPair({ state: "failed", reason: collabErrorText(error) });
      },
    );
    return () => {
      current = false;
    };
  }, [projectId, from, to, path]);
  if (pair.state === "loading") {
    return <p className="text-xs text-muted-foreground">{t(($) => $.collab.history.loadingFile)}</p>;
  }
  if (pair.state === "failed") return <InlineAlert>{pair.reason}</InlineAlert>;
  return (
    <div id={id} className="space-y-1">
      {!pair.before.existed || !pair.after.existed ? (
        <Badge variant="primaryGhost" size="sm">
          {pair.before.existed ? t(($) => $.collab.mergeReview.removedFile) : t(($) => $.collab.mergeReview.newFile)}
        </Badge>
      ) : null}
      <DiffPreview
        path={path}
        oldText={pair.before.text ?? ""}
        newText={pair.after.text ?? ""}
        label={t(($) => $.collab.mergeReview.diffLabel, { path })}
        loadingLabel={t(($) => $.collab.history.loadingFile)}
      />
    </div>
  );
}

export function HistoryCompareDialog({
  projectId,
  older,
  newer,
  onClose,
}: Readonly<{ projectId: string; older: CollabHistoryEntry; newer: CollabHistoryEntry; onClose: () => void }>) {
  const { t } = useTranslation(["collab", "common"]);
  const titleId = useId();
  const filesId = useId();
  const [listed, setListed] = useState<Listed>({ state: "loading" });
  const [open, setOpen] = useState<readonly string[]>([]);
  const earlier = t(($) => $.collab.history.earlier);
  const close = t(($) => $.common.actions.close);

  useEffect(() => {
    let current = true;
    setListed({ state: "loading" });
    collabHistoryChangedFiles(projectId, older.id, newer.id).then(
      (paths) => {
        if (!current) return;
        setListed({ state: "ready", paths });
        setOpen(paths.slice(0, MAX_OPEN_DIFFS));
      },
      (error: unknown) => {
        void logError("collab history compare", error);
        if (current) setListed({ state: "failed", reason: collabErrorText(error) });
      },
    );
    return () => {
      current = false;
    };
  }, [projectId, older.id, newer.id]);

  const toggle = (path: string) => {
    if (open.includes(path)) {
      setOpen(open.filter((item) => item !== path));
      return;
    }
    setOpen([...open, path].slice(-MAX_OPEN_DIFFS));
  };

  return (
    <ModalShell
      open
      portal
      onClose={onClose}
      closeLabel={close}
      width="2xl"
      labelledBy={titleId}
      className="flex max-h-[85vh] flex-col gap-4 p-5"
      testId="collab-history-compare"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h2 id={titleId} className="text-base font-semibold">
            {t(($) => $.collab.history.compareTitle)}
          </h2>
          <p className="break-words text-xs text-muted-foreground">
            {t(($) => $.collab.history.compareDescription, {
              from: historyEntryTitle(older, earlier),
              to: historyEntryTitle(newer, earlier),
            })}
          </p>
        </div>
        <Button type="button" variant="ghost" size="icon" className="size-7 shrink-0" aria-label={close} onClick={onClose}>
          <X aria-hidden className="size-4" />
        </Button>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto">
        {listed.state === "loading" ? (
          <p className="text-xs text-muted-foreground">{t(($) => $.collab.history.loadingFile)}</p>
        ) : null}
        {listed.state === "failed" ? <InlineAlert>{listed.reason}</InlineAlert> : null}
        {listed.state === "ready" && listed.paths.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t(($) => $.collab.history.noChanges)}</p>
        ) : null}
        {listed.state === "ready" && listed.paths.length > 0 ? (
          <section className="space-y-1.5">
            <h3 id={filesId} className="text-xs font-medium text-muted-foreground">
              {t(($) => $.collab.history.changedFiles, { number: formatNumber(listed.paths.length) })}
            </h3>
            <ul aria-labelledby={filesId} className="space-y-3">
              {listed.paths.map((path, index) => {
                const expanded = open.includes(path);
                const diffId = `${filesId}-${index}`;
                return (
                  <li key={path} className="space-y-1.5">
                    <button
                      type="button"
                      aria-expanded={expanded}
                      aria-controls={expanded ? diffId : undefined}
                      onClick={() => toggle(path)}
                      className="flex w-full min-w-0 items-center gap-2 rounded-md px-1 py-0.5 text-left text-xs transition-colors hover:bg-accent focus-visible:bg-accent"
                    >
                      <ChevronRight
                        aria-hidden
                        className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", expanded && "rotate-90")}
                      />
                      <span className="truncate font-mono">{path}</span>
                    </button>
                    {expanded ? (
                      <FileDiff projectId={projectId} from={older.id} to={newer.id} path={path} id={diffId} />
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}
      </div>
    </ModalShell>
  );
}
