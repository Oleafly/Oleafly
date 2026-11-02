import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { FileText } from "@/components/icons/pack";
import { Button } from "@/components/ui/button";
import { CodeBlock } from "@/components/ui/code-block";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { ModalShell } from "@/components/ui/modal-shell";
import { formatDateTime } from "@/lib/intl";
import { logError } from "@/lib/log";
import type { CollabFileAtVersion, CollabHistoryEntry } from "@/lib/tauri";
import { collabHistoryFile, collabHistoryRestore } from "@/lib/tauri-collab";
import { cn } from "@/lib/utils";
import { collabErrorText } from "../errors";
import { InlineAlert } from "../feedback";

type Loaded = { state: "idle" } | { state: "loading" } | { state: "failed"; reason: string } | { state: "ready"; file: CollabFileAtVersion };

type Restoring = { scope: "file"; path: string } | { scope: "project" } | null;

export function historyEntryTitle(entry: CollabHistoryEntry, earlier: string): string {
  if (entry.name) return entry.name;
  return entry.at > 0 ? formatDateTime(entry.at) : earlier;
}

export function HistoryVersionDialog({
  projectId,
  entry,
  initialPath,
  canRestore,
  onRestored,
  onClose,
}: Readonly<{
  projectId: string;
  entry: CollabHistoryEntry;
  initialPath: string | null;
  canRestore: boolean;
  onRestored: () => void;
  onClose: () => void;
}>) {
  const { t } = useTranslation(["collab", "common"]);
  const titleId = useId();
  const filesId = useId();
  const paths = initialPath && !entry.files.includes(initialPath) ? [initialPath, ...entry.files] : entry.files;
  const [path, setPath] = useState<string | null>(initialPath ?? paths[0] ?? null);
  const [loaded, setLoaded] = useState<Loaded>({ state: "idle" });
  const [confirming, setConfirming] = useState<Restoring>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const earlier = t(($) => $.collab.history.earlier);
  const title = historyEntryTitle(entry, earlier);
  const when = entry.at > 0 ? formatDateTime(entry.at) : earlier;
  const close = t(($) => $.common.actions.close);

  useEffect(() => {
    if (!path) return;
    let current = true;
    setLoaded({ state: "loading" });
    collabHistoryFile(projectId, entry.id, path).then(
      (file) => {
        if (current) setLoaded({ state: "ready", file });
      },
      (error: unknown) => {
        void logError("collab history file", error);
        if (current) setLoaded({ state: "failed", reason: collabErrorText(error) });
      },
    );
    return () => {
      current = false;
    };
  }, [projectId, entry.id, path]);

  const restore = async (target: NonNullable<Restoring>) => {
    setBusy(true);
    setFailure(null);
    try {
      await collabHistoryRestore(projectId, entry.id, target.scope === "file" ? [target.path] : null);
      onRestored();
      onClose();
    } catch (error) {
      void logError("collab history restore", error);
      setFailure(collabErrorText(error));
    } finally {
      setBusy(false);
    }
  };

  const fileText = () => {
    if (loaded.state === "loading" || loaded.state === "idle") {
      return <p className="text-xs text-muted-foreground">{t(($) => $.collab.history.loadingFile)}</p>;
    }
    if (loaded.state === "failed") return <InlineAlert>{loaded.reason}</InlineAlert>;
    if (!loaded.file.existed || loaded.file.text === null) {
      return <p className="text-xs text-muted-foreground">{t(($) => $.collab.history.fileMissing)}</p>;
    }
    return (
      <figure className="m-0 space-y-1">
        <figcaption className="sr-only">
          {t(($) => $.collab.history.fileLabel, { path: loaded.file.path, time: when })}
        </figcaption>
        <CodeBlock code={loaded.file.text} preClassName="whitespace-pre-wrap break-words" />
      </figure>
    );
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
      testId="collab-history-version"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h2 id={titleId} className="break-words text-base font-semibold">
            {title}
          </h2>
          <p className="text-xs text-muted-foreground">
            {entry.name ? when : t(($) => $.collab.history.versionDescription)}
          </p>
        </div>
        <Button type="button" variant="ghost" size="icon" className="size-7 shrink-0" aria-label={close} onClick={onClose}>
          <X aria-hidden className="size-4" />
        </Button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
        {paths.length > 0 ? (
          <section className="space-y-1.5">
            <h3 id={filesId} className="text-xs font-medium text-muted-foreground">
              {t(($) => $.collab.history.files)}
            </h3>
            <ul aria-labelledby={filesId} className="flex flex-wrap gap-1">
              {paths.map((file) => (
                <li key={file}>
                  <button
                    type="button"
                    aria-pressed={file === path}
                    onClick={() => setPath(file)}
                    className={cn(
                      "flex max-w-full items-center gap-1 rounded-md border px-2 py-1 font-mono text-xs transition-colors",
                      file === path
                        ? "border-primary/30 bg-primary/10 text-foreground"
                        : "border-border text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:bg-accent",
                    )}
                  >
                    <FileText aria-hidden className="size-3 shrink-0" />
                    <span className="truncate">{file}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : (
          <p className="text-xs text-muted-foreground">{t(($) => $.collab.history.noFiles)}</p>
        )}
        {path ? fileText() : null}
        {failure ? <InlineAlert>{failure}</InlineAlert> : null}
      </div>
      {canRestore ? (
        <div className="flex flex-wrap justify-end gap-2">
          {path && loaded.state === "ready" && loaded.file.existed ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => setConfirming({ scope: "file", path })}
            >
              {t(($) => $.collab.history.restoreFile)}
            </Button>
          ) : null}
          <Button type="button" size="sm" disabled={busy} onClick={() => setConfirming({ scope: "project" })}>
            {t(($) => $.collab.history.restoreProject)}
          </Button>
        </div>
      ) : null}
      <ConfirmationDialog
        open={confirming?.scope === "file"}
        title={t(($) => $.collab.history.restoreFileConfirm.title, {
          path: confirming?.scope === "file" ? confirming.path : "",
        })}
        description={t(($) => $.collab.history.restoreFileConfirm.description, { time: when })}
        confirmLabel={t(($) => $.collab.history.restoreFileConfirm.confirm)}
        onConfirm={() => {
          const target = confirming;
          setConfirming(null);
          if (target) void restore(target);
        }}
        onCancel={() => setConfirming(null)}
      />
      <ConfirmationDialog
        open={confirming?.scope === "project"}
        title={t(($) => $.collab.history.restoreProjectConfirm.title)}
        description={t(($) => $.collab.history.restoreProjectConfirm.textAndDeleted, { time: when })}
        confirmLabel={t(($) => $.collab.history.restoreProjectConfirm.confirm)}
        destructive
        onConfirm={() => {
          setConfirming(null);
          void restore({ scope: "project" });
        }}
        onCancel={() => setConfirming(null)}
      />
    </ModalShell>
  );
}
