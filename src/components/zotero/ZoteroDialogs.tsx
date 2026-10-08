import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { BookPlus, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { LoadingState } from "@/components/ui/empty";
import { ModalShell } from "@/components/ui/modal-shell";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Spinner } from "@/components/ui/spinner";
import { ZoteroHintBanner } from "@/components/zotero/ZoteroHintBanner";
import { describeError } from "@/lib/app-error";
import { logError } from "@/lib/log";
import { hitByline, hitTitle, truncated } from "@/lib/zotero/format";
import {
  ensureZoteroEntries,
  findMissingInZotero,
  staleZoteroEntries,
  updateZoteroEntries,
  type MissingReport,
  type StaleEntry,
} from "@/features/zotero-cite";
import { useZoteroStaleStore } from "@/features/zotero-actions";
import { useZoteroDialogStore } from "@/store/zotero-dialogs";

const ROW_STYLE = { contentVisibility: "auto", containIntrinsicSize: "36px" } as const;

function BibliographyChoiceDialog() {
  const { t } = useTranslation(["common", "references"]);
  const pending = useZoteroDialogStore((state) => state.bibliographyChoice);
  const [choice, setChoice] = useState<string | null>(null);
  const titleId = useId();
  const descriptionId = useId();
  useEffect(() => {
    setChoice(pending?.value[0] ?? null);
  }, [pending]);
  if (!pending) return null;
  return (
    <ModalShell
      open
      onClose={() => pending.resolve(null)}
      closeLabel={t(($) => $.common.actions.cancel)}
      layer="raised"
      width="md"
      labelledBy={titleId}
      describedBy={descriptionId}
      className="p-5"
      testId="zotero-bibliography-choice"
    >
      <h2 id={titleId} className="text-sm font-semibold">
        {t(($) => $.references.zotero.chooseBibliography.title)}
      </h2>
      <p id={descriptionId} className="mt-2 text-xs leading-relaxed text-muted-foreground">
        {t(($) => $.references.zotero.chooseBibliography.description)}
      </p>
      <RadioGroup
        value={choice ?? undefined}
        onValueChange={setChoice}
        aria-labelledby={titleId}
        className="mt-4"
      >
        {pending.value.map((path, index) => (
          <div key={path} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-accent">
            <RadioGroupItem
              id={`${titleId}-${index}`}
              value={path}
              data-modal-initial-focus={index === 0 ? true : undefined}
            />
            <label htmlFor={`${titleId}-${index}`} className="min-w-0 flex-1 truncate font-mono">
              {path}
            </label>
          </div>
        ))}
      </RadioGroup>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={() => pending.resolve(null)}>
          {t(($) => $.common.actions.cancel)}
        </Button>
        <Button size="sm" disabled={!choice} onClick={() => pending.resolve(choice)}>
          {t(($) => $.references.zotero.chooseBibliography.confirm)}
        </Button>
      </div>
    </ModalShell>
  );
}

function HandEditConfirm() {
  const { t } = useTranslation("references");
  const pending = useZoteroDialogStore((state) => state.handEdits);
  if (!pending) return null;
  const key = pending.value[0]?.key ?? "";
  return (
    <ConfirmationDialog
      open
      title={t(($) => $.references.zotero.handEdits.title)}
      description={t(($) => $.references.zotero.handEdits.description, { key })}
      confirmLabel={t(($) => $.references.zotero.handEdits.confirm)}
      cancelLabel={t(($) => $.references.zotero.handEdits.cancel)}
      destructive
      onConfirm={() => pending.resolve(true)}
      onCancel={() => pending.resolve(false)}
    />
  );
}

function HandListConfirm() {
  const { t } = useTranslation("references");
  const pending = useZoteroDialogStore((state) => state.handList);
  if (!pending) return null;
  return (
    <ConfirmationDialog
      open
      title={t(($) => $.references.zotero.handList.title)}
      description={t(($) => $.references.zotero.handList.description, { path: pending.value.bib })}
      confirmLabel={t(($) => $.references.zotero.handList.confirm)}
      onConfirm={() => pending.resolve(true)}
      onCancel={() => pending.resolve(false)}
    />
  );
}

type Phase = "loading" | "ready" | "working" | "done" | "error";

function MissingBody({ onClose }: Readonly<{ onClose: () => void }>) {
  const { t } = useTranslation(["common", "references"]);
  const [phase, setPhase] = useState<Phase>("loading");
  const [report, setReport] = useState<MissingReport | null>(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let current = true;
    findMissingInZotero()
      .then((found) => {
        if (!current) return;
        setReport(found);
        setPhase("ready");
      })
      .catch((error: unknown) => {
        void logError("find missing citations in Zotero", error);
        if (!current) return;
        setMessage(describeError(error));
        setPhase("error");
      });
    return () => {
      current = false;
    };
  }, []);

  const add = async () => {
    if (!report) return;
    setPhase("working");
    try {
      const chooseBibliography = (choices: readonly string[]) => useZoteroDialogStore.getState().chooseBibliography(choices);
      const result = await ensureZoteroEntries(report.found, { chooseBibliography });
      if (result.error) {
        setMessage(t(($) => $.references.zotero.missing.failed, { detail: result.error }));
        setPhase("error");
        return;
      }
      setMessage(
        t(($) => $.references.zotero.missing.done, {
          count: result.added.length + result.reused.length,
          path: result.bibPath ?? "",
        }),
      );
      setPhase("done");
      void useZoteroStaleStore.getState().refresh();
    } catch (error) {
      void logError("add missing citations from Zotero", error);
      setMessage(t(($) => $.references.zotero.missing.failed, { detail: describeError(error) }));
      setPhase("error");
    }
  };

  const found = report?.found ?? [];
  return (
    <>
      <div className="max-h-[50vh] flex-1 overflow-y-auto px-4 py-3" aria-live="polite" aria-busy={phase === "loading" || phase === "working"}>
        {phase === "loading" && <LoadingState className="py-4" label={t(($) => $.references.zotero.missing.loading)} />}
        {phase === "error" && (
          <p role="alert" className="select-text text-xs text-destructive">
            {message}
          </p>
        )}
        {phase === "done" && <output className="block text-xs">{message}</output>}
        {(phase === "ready" || phase === "working") && report && (
          <div className="space-y-4">
            {found.length === 0 && report.missing.length === 0 && report.duplicates.length === 0 && (
              <p className="text-xs text-muted-foreground">{t(($) => $.references.zotero.missing.none)}</p>
            )}
            {found.length > 0 && (
              <section>
                <h3 className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  {t(($) => $.references.zotero.missing.found, { count: found.length })}
                </h3>
                <ul className="space-y-0.5">
                  {found.map((pick) => (
                    <li key={pick.key} className="grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-2 text-xs" style={ROW_STYLE}>
                      <span className="truncate font-mono">{pick.key}</span>
                      <span className="truncate text-muted-foreground">
                        {[hitByline(pick.hit), truncated(hitTitle(pick.hit))].filter(Boolean).join(" · ")}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {report.duplicates.length > 0 && (
              <section>
                <h3 className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  {t(($) => $.references.zotero.missing.duplicates, { count: report.duplicates.length })}
                </h3>
                <ul className="space-y-0.5">
                  {report.duplicates.map((duplicate) => (
                    <li key={duplicate.key} className="text-xs" style={ROW_STYLE}>
                      {t(($) => $.references.zotero.missing.duplicateRow, duplicate)}
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {report.missing.length > 0 && (
              <section>
                <h3 className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  {t(($) => $.references.zotero.missing.notFound, { count: report.missing.length })}
                </h3>
                <p className="select-text break-words font-mono text-xs text-muted-foreground">{report.missing.join(", ")}</p>
              </section>
            )}
          </div>
        )}
      </div>
      <div className="flex justify-end gap-2 border-t px-4 py-3">
        <Button variant="ghost" size="sm" onClick={onClose}>
          {phase === "done" ? t(($) => $.common.actions.close) : t(($) => $.common.actions.cancel)}
        </Button>
        {(phase === "ready" || phase === "working") && found.length > 0 && (
          <Button size="sm" disabled={phase === "working"} onClick={() => void add()} data-testid="zotero-missing-confirm">
            {phase === "working" && <Spinner />}
            {t(($) => $.references.zotero.missing.confirm, { count: found.length })}
          </Button>
        )}
      </div>
    </>
  );
}

function UpdateBody({ onClose }: Readonly<{ onClose: () => void }>) {
  const { t } = useTranslation(["common", "references"]);
  const [phase, setPhase] = useState<Phase>("loading");
  const [entries, setEntries] = useState<StaleEntry[]>([]);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [message, setMessage] = useState("");
  const listId = useId();

  useEffect(() => {
    let current = true;
    staleZoteroEntries()
      .then((found) => {
        if (!current) return;
        setEntries(found);
        setSelected(new Set(found.filter((entry) => !entry.handEdited).map((entry) => entry.key)));
        setPhase("ready");
      })
      .catch((error: unknown) => {
        void logError("check Zotero for changed entries", error);
        if (!current) return;
        setMessage(describeError(error));
        setPhase("error");
      });
    return () => {
      current = false;
    };
  }, []);

  const update = async () => {
    setPhase("working");
    try {
      const result = await updateZoteroEntries(entries.filter((entry) => selected.has(entry.key)));
      setMessage(t(($) => $.references.zotero.update.done, { count: result.updated.length }));
      setPhase("done");
    } catch (error) {
      void logError("update entries from Zotero", error);
      setMessage(describeError(error));
      setPhase("error");
    } finally {
      void useZoteroStaleStore.getState().refresh();
    }
  };

  const toggle = (key: string, on: boolean) => {
    setSelected((previous) => {
      const next = new Set(previous);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
  };

  const anyHandEdited = entries.some((entry) => entry.handEdited);
  return (
    <>
      <div className="max-h-[50vh] flex-1 overflow-y-auto px-4 py-3" aria-live="polite" aria-busy={phase === "loading" || phase === "working"}>
        {phase === "loading" && <LoadingState className="py-4" label={t(($) => $.references.zotero.update.loading)} />}
        {phase === "error" && (
          <p role="alert" className="select-text text-xs text-destructive">
            {message}
          </p>
        )}
        {phase === "done" && <output className="block text-xs">{message}</output>}
        {(phase === "ready" || phase === "working") && entries.length === 0 && (
          <p className="text-xs text-muted-foreground">{t(($) => $.references.zotero.update.none)}</p>
        )}
        {(phase === "ready" || phase === "working") && entries.length > 0 && (
          <>
            {anyHandEdited && (
              <p className="mb-2 text-xs text-muted-foreground">{t(($) => $.references.zotero.update.handEditedNote)}</p>
            )}
            <ul className="space-y-1">
              {entries.map((entry, index) => (
                <li key={entry.key} style={ROW_STYLE} className="flex items-center gap-2 rounded-md px-1 py-1 text-xs hover:bg-accent">
                  <Checkbox
                    id={`${listId}-${index}`}
                    checked={selected.has(entry.key)}
                    onCheckedChange={(value) => toggle(entry.key, value === true)}
                  />
                  <label htmlFor={`${listId}-${index}`} className="flex min-w-0 flex-1 items-center gap-2">
                    <span className="font-mono">{entry.key}</span>
                    <span className="min-w-0 flex-1 truncate text-muted-foreground">
                      {[hitByline(entry.hit), truncated(hitTitle(entry.hit))].filter(Boolean).join(" · ")}
                    </span>
                    {entry.handEdited && (
                      <span className="shrink-0 text-[10px] font-medium text-amber-700 dark:text-amber-300">
                        {t(($) => $.references.zotero.update.handEdited)}
                      </span>
                    )}
                  </label>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
      <div className="flex justify-end gap-2 border-t px-4 py-3">
        <Button variant="ghost" size="sm" onClick={onClose}>
          {phase === "done" ? t(($) => $.common.actions.close) : t(($) => $.common.actions.cancel)}
        </Button>
        {(phase === "ready" || phase === "working") && entries.length > 0 && (
          <Button size="sm" disabled={phase === "working" || selected.size === 0} onClick={() => void update()} data-testid="zotero-update-confirm">
            {phase === "working" && <Spinner />}
            {t(($) => $.references.zotero.update.confirm, { count: selected.size })}
          </Button>
        )}
      </div>
    </>
  );
}

function BulkDialog() {
  const { t } = useTranslation(["common", "references"]);
  const kind = useZoteroDialogStore((state) => state.bulk);
  const close = useZoteroDialogStore((state) => state.closeBulk);
  const titleId = useId();
  if (!kind) return null;
  return (
    <ModalShell
      open
      onClose={close}
      closeLabel={t(($) => $.common.actions.close)}
      align="top"
      labelledBy={titleId}
      className="flex max-h-[70vh] w-[34rem] max-w-[92vw] flex-col"
      testId={`zotero-${kind}-dialog`}
    >
      <div className="flex items-center gap-2 border-b px-4 py-3">
        {kind === "missing" ? (
          <BookPlus aria-hidden className="size-4 text-muted-foreground" />
        ) : (
          <RefreshCw aria-hidden className="size-4 text-muted-foreground" />
        )}
        <h2 id={titleId} className="text-sm font-semibold" tabIndex={-1} data-modal-initial-focus>
          {kind === "missing"
            ? t(($) => $.references.zotero.missing.title)
            : t(($) => $.references.zotero.update.title)}
        </h2>
      </div>
      <ZoteroHintBanner onOpenSettings={close} />
      {kind === "missing" ? <MissingBody onClose={close} /> : <UpdateBody onClose={close} />}
    </ModalShell>
  );
}

export function ZoteroDialogs() {
  return (
    <>
      <BulkDialog />
      <BibliographyChoiceDialog />
      <HandEditConfirm />
      <HandListConfirm />
    </>
  );
}
