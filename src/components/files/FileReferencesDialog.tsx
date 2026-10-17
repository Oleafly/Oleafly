import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ModalShell } from "@/components/ui/modal-shell";
import { answerReferenceUpdate, startFileReferenceUpdates } from "@/lib/file-references/follow-rename";
import { basename } from "@/lib/path-utils";
import { useFileReferencesStore } from "@/store/file-references";

export function FileReferencesDialog() {
  const { t } = useTranslation(["common", "workspace"]);
  const pending = useFileReferencesStore((state) => state.queue[0] ?? null);
  const phase = useFileReferencesStore((state) => state.phase);
  const failed = useFileReferencesStore((state) => state.failed);
  const [remember, setRemember] = useState(false);
  const titleId = useId();
  const descriptionId = useId();
  const rememberId = useId();
  const pendingId = pending?.id;

  useEffect(() => startFileReferenceUpdates(), []);

  useEffect(() => {
    if (pendingId !== undefined) setRemember(false);
  }, [pendingId]);

  if (!pending) return null;

  const applying = phase === "applying";
  const close = () => useFileReferencesStore.getState().finish();
  const answer = (update: boolean) => {
    void answerReferenceUpdate(update, remember);
  };
  const rows =
    phase === "failed"
      ? failed.map((path) => ({ path, references: null }))
      : pending.plan.files.map((file) => ({ path: file.path, references: file.references }));

  return (
    <ModalShell
      open
      onClose={phase === "failed" ? close : () => answer(false)}
      closeLabel={t(($) => $.workspace.fileReferences.close)}
      layer="nested"
      width="md"
      role="alertdialog"
      labelledBy={titleId}
      describedBy={descriptionId}
      className="p-5"
      testId="file-references-dialog"
    >
      <h2 id={titleId} className="break-words text-sm font-semibold">
        {t(($) => $.workspace.fileReferences.title, { name: basename(pending.from) })}
      </h2>
      <p id={descriptionId} className="mt-2 break-words text-xs leading-relaxed text-muted-foreground">
        {phase === "failed"
          ? t(($) => $.workspace.fileReferences.failed, { count: failed.length })
          : t(($) => $.workspace.fileReferences.summary, {
              count: pending.plan.references,
              files: pending.plan.files.length,
              path: pending.from,
            })}
      </p>
      <ul className="mt-3 max-h-48 divide-y overflow-y-auto rounded-md border text-xs">
        {rows.map((row) => (
          <li key={row.path} className="flex items-center justify-between gap-3 px-3 py-1.5">
            <span className="min-w-0 truncate font-mono" title={row.path}>
              {row.path}
            </span>
            {row.references === null ? null : (
              <span className="shrink-0 text-muted-foreground">
                {t(($) => $.workspace.fileReferences.fileCount, { count: row.references })}
              </span>
            )}
          </li>
        ))}
      </ul>
      {phase === "failed" ? (
        <div className="mt-5 flex justify-end">
          <Button size="sm" onClick={close} data-modal-initial-focus>
            {t(($) => $.common.actions.close)}
          </Button>
        </div>
      ) : (
        <>
          <label htmlFor={rememberId} className="mt-4 flex w-fit cursor-pointer items-center gap-2 text-xs">
            <Checkbox
              id={rememberId}
              checked={remember}
              disabled={applying}
              onCheckedChange={(checked) => setRemember(checked === true)}
            />
            {t(($) => $.workspace.fileReferences.dontAsk)}
          </label>
          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => answer(false)} disabled={applying}>
              {t(($) => $.workspace.fileReferences.skip)}
            </Button>
            <Button size="sm" onClick={() => answer(true)} disabled={applying} data-modal-initial-focus>
              {t(($) => $.workspace.fileReferences.update)}
            </Button>
          </div>
        </>
      )}
    </ModalShell>
  );
}
