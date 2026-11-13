import { FileInput, FolderOutput, Link2Off, MoreHorizontal } from "lucide-react";
import { useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ErrorState } from "@/components/ui/empty";
import { Tooltip } from "@/components/ui/tooltip";
import { Progress } from "@/components/ui/progress";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { describeError } from "@/lib/app-error";
import { useDisplayPath } from "@/lib/display-path";
import { formatDate, formatNumber } from "@/lib/intl";
import { logError } from "@/lib/log";
import { announceExport, cancelImport, exportFolder, importFolder, newRunId, progressPercent, stepAfter, type ImportStep } from "./note-vault";

export interface NoteImportDialogProps {
  open: boolean;
  onClose: () => void;
  onImported: () => void;
}

function NameList({ label, names }: Readonly<{ label: string; names: readonly string[] }>) {
  const shownPath = useDisplayPath();
  return (
    <li className="text-muted-foreground">
      {label}
      {names.length > 0 && (
        <ul className="mt-1 max-h-32 space-y-0.5 overflow-y-auto pl-4 text-xs">
          {names.map((name) => (
            <li key={name} className="min-w-0">
              <Tooltip label={shownPath(name)} className="block min-w-0">
                <span className="block truncate">{shownPath(name)}</span>
              </Tooltip>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

type ImportProgress = Extract<ImportStep, { step: "running" }>["progress"];

function ImportProgressLabel({ progress, picking }: Readonly<{ progress: ImportProgress; picking: "folder" | "files" }>) {
  const { t } = useTranslation(["notes"]);
  if (progress) {
    return progress.phase === "read"
      ? t(($) => $.notes.vault.import.reading, { file: progress.file })
      : t(($) => $.notes.vault.import.writing, { file: progress.file });
  }
  return picking === "files" ? t(($) => $.notes.vault.import.filesPickerTitle) : t(($) => $.notes.vault.import.pickerTitle);
}

export function NoteImportDialog({ open, onClose, onImported }: Readonly<NoteImportDialogProps>) {
  const { t } = useTranslation(["notes", "common"]);
  const [state, setState] = useState<ImportStep>({ step: "options" });
  const [folderTags, setFolderTags] = useState(false);
  const [picking, setPicking] = useState<"folder" | "files">("folder");
  const [failure, setFailure] = useState("");
  const runRef = useRef<string | null>(null);
  const tagsId = useId();

  const run = (again: boolean, files = false, confirmed = false) => {
    const runId = again && runRef.current ? runRef.current : newRunId();
    runRef.current = runId;
    setPicking(files ? "files" : "folder");
    setState({ step: "running", runId, progress: null, stopping: false });
    const choice = { folderTags, again, confirmLarge: !confirmed };
    importFolder(runId, files ? { ...choice, files } : choice, (progress) =>
      setState((current) => (current.step === "running" ? { ...current, progress } : current)),
    ).then(
      (outcome) => {
        const next = stepAfter(outcome);
        if (next.step === "done" && next.summary.notes > 0) onImported();
        setState(next);
      },
      (error: unknown) => {
        void logError(files ? "import Markdown files" : "import a Markdown folder", error);
        setFailure(describeError(error));
        setState({ step: "failed" });
      },
    );
  };

  const stop = (running: Extract<ImportStep, { step: "running" }>) => {
    setState({ ...running, stopping: true });
    cancelImport(running.runId).catch((error: unknown) => void logError("stop the Markdown import", error));
  };

  const close = () => {
    if (state.step === "running") {
      stop(state);
      return;
    }
    if ((state.step === "seen" || state.step === "large") && runRef.current) {
      cancelImport(runRef.current).catch((error: unknown) => void logError("forget the Markdown import", error));
    }
    runRef.current = null;
    setState({ step: "options" });
    onClose();
  };

  const progress = state.step === "running" ? state.progress : null;
  const percent = progressPercent(progress);
  const summary = state.step === "done" ? state.summary : null;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent className="sm:max-w-md">
        {state.step === "seen" && (
          <DialogHeader>
            <DialogTitle>{t(($) => $.notes.vault.import.seenTitle)}</DialogTitle>
            <DialogDescription>
              {t(($) => $.notes.vault.import.seenDescription, { count: state.notes, date: formatDate(state.importedAt) })}
            </DialogDescription>
          </DialogHeader>
        )}
        {state.step === "large" && (
          <DialogHeader>
            <DialogTitle>{t(($) => $.notes.vault.import.largeTitle, { total: formatNumber(state.notes) })}</DialogTitle>
            <DialogDescription>{t(($) => $.notes.vault.import.largeDescription)}</DialogDescription>
          </DialogHeader>
        )}
        {state.step !== "seen" && state.step !== "large" && (
          <DialogHeader>
            <DialogTitle>
              {state.step === "done" ? t(($) => $.notes.vault.import.doneTitle) : t(($) => $.notes.vault.import.title)}
            </DialogTitle>
            <DialogDescription>{t(($) => $.notes.vault.import.description)}</DialogDescription>
          </DialogHeader>
        )}
        {state.step === "options" && (
          <div className="flex items-start gap-2">
            <Checkbox id={tagsId} checked={folderTags} onCheckedChange={(checked) => setFolderTags(checked === true)} className="mt-0.5" />
            <label htmlFor={tagsId} className="text-sm">
              {t(($) => $.notes.vault.import.folderTags)}
              <span className="block text-xs text-muted-foreground">{t(($) => $.notes.vault.import.folderTagsHint)}</span>
            </label>
          </div>
        )}
        {state.step === "running" && (
          <div className="space-y-2">
            <Progress value={percent} indeterminate={progress === null} label={t(($) => $.notes.vault.import.title)} />
            <p className="flex items-center justify-between gap-3 text-xs text-muted-foreground" aria-live="polite">
              <span className="min-w-0 truncate">
                <ImportProgressLabel progress={progress} picking={picking} />
              </span>
              {progress && (
                <span className="shrink-0 tabular-nums">
                  {t(($) => $.notes.vault.import.progress, { done: progress.done, total: progress.total })}
                </span>
              )}
            </p>
          </div>
        )}
        {summary && (
          <ul className="space-y-1 text-sm" aria-live="polite">
            {summary.cancelled ? (
              <li>{t(($) => $.notes.vault.import.cancelled)}</li>
            ) : (
              <>
                <li>{t(($) => $.notes.vault.import.notes, { count: summary.notes })}</li>
                {summary.attachments > 0 && <li>{t(($) => $.notes.vault.import.attachments, { count: summary.attachments })}</li>}
                {summary.unresolved > 0 && (
                  <li className="text-muted-foreground">{t(($) => $.notes.vault.import.unresolved, { count: summary.unresolved })}</li>
                )}
                {summary.skipped > 0 && (
                  <NameList label={t(($) => $.notes.vault.import.skipped, { count: summary.skipped })} names={summary.skippedNotes} />
                )}
                {summary.notCopied.length > 0 && (
                  <NameList label={t(($) => $.notes.vault.import.notCopied, { count: summary.notCopied.length })} names={summary.notCopied} />
                )}
              </>
            )}
          </ul>
        )}
        {state.step === "failed" && (
          <ErrorState message={t(($) => $.notes.vault.import.failed)}>
            {failure && <p className="text-xs text-destructive">{failure}</p>}
          </ErrorState>
        )}
        <DialogFooter>
          {state.step === "options" && (
            <>
              <Button variant="ghost" onClick={close}>
                {t(($) => $.common.actions.cancel)}
              </Button>
              <Button variant="outline" onClick={() => run(false, true)}>
                {t(($) => $.notes.vault.import.chooseFiles)}
              </Button>
              <Button onClick={() => run(false)}>{t(($) => $.notes.vault.import.choose)}</Button>
            </>
          )}
          {state.step === "running" && (
            <Button variant="outline" disabled={state.stopping} onClick={() => stop(state)}>
              {t(($) => $.notes.vault.import.stop)}
            </Button>
          )}
          {state.step === "seen" && (
            <>
              <Button variant="ghost" onClick={close}>
                {t(($) => $.common.actions.cancel)}
              </Button>
              <Button onClick={() => run(true)}>{t(($) => $.notes.vault.import.again)}</Button>
            </>
          )}
          {state.step === "large" && (
            <>
              <Button variant="ghost" onClick={close}>
                {t(($) => $.common.actions.cancel)}
              </Button>
              <Button onClick={() => run(true, picking === "files", true)}>{t(($) => $.notes.vault.import.largeConfirm)}</Button>
            </>
          )}
          {(state.step === "done" || state.step === "failed") && <Button onClick={close}>{t(($) => $.notes.vault.import.done)}</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export interface NoteExportDialogProps {
  open: boolean;
  note: { id: string; title: string } | null;
  total: number;
  onClose: () => void;
}

export function NoteExportDialog({ open, note, total, onClose }: Readonly<NoteExportDialogProps>) {
  const { t } = useTranslation(["notes", "common"]);
  const [scope, setScope] = useState<"note" | "all">(note ? "note" : "all");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const fieldId = useId();
  const chosen = note && scope === "note" ? note : null;

  const run = () => {
    setBusy(true);
    setFailure(null);
    exportFolder(chosen)
      .then(
        (summary) => {
          if (!summary) return;
          announceExport(summary);
          onClose();
        },
        (error: unknown) => {
          void logError("export notes", error);
          setFailure(describeError(error));
        },
      )
      .finally(() => setBusy(false));
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !busy && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t(($) => $.notes.vault.import.export.title)}</DialogTitle>
          <DialogDescription>{t(($) => $.notes.vault.import.export.description)}</DialogDescription>
        </DialogHeader>
        {note && (
          <RadioGroup value={scope} onValueChange={(value) => setScope(value === "note" ? "note" : "all")} className="gap-1">
            <label htmlFor={`${fieldId}-note`} className="flex min-w-0 items-center gap-2 text-sm">
              <RadioGroupItem id={`${fieldId}-note`} value="note" />
              <span className="truncate">{t(($) => $.notes.vault.import.export.thisNote, { title: note.title })}</span>
            </label>
            <label htmlFor={`${fieldId}-all`} className="flex items-center gap-2 text-sm">
              <RadioGroupItem id={`${fieldId}-all`} value="all" />
              {t(($) => $.notes.vault.import.export.allNotes, { count: total })}
            </label>
          </RadioGroup>
        )}
        {failure !== null && (
          <ErrorState message={t(($) => $.notes.vault.import.export.failed)}>
            {failure && <p className="text-xs text-destructive">{failure}</p>}
          </ErrorState>
        )}
        <DialogFooter>
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            {t(($) => $.common.actions.cancel)}
          </Button>
          <Button disabled={busy || total === 0} onClick={run}>
            {t(($) => $.notes.vault.import.export.export)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export interface VaultMoreMenuProps {
  onImportFolder?: () => void;
  onExportFolder?: () => void;
  onOpenDeadLinks?: () => void;
}

export function VaultMoreMenu({ onImportFolder, onExportFolder, onOpenDeadLinks }: Readonly<VaultMoreMenuProps>) {
  const { t } = useTranslation(["notes"]);
  const pending = useRef<(() => void) | null>(null);
  const later = (action: () => void) => () => {
    pending.current = action;
  };
  if (!onImportFolder && !onExportFolder && !onOpenDeadLinks) return null;
  return (
    <DropdownMenu>
      <Tooltip label={t(($) => $.notes.vault.import.more)} side="top">
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={t(($) => $.notes.vault.import.more)} className="size-8 data-[state=open]:bg-accent">
            <MoreHorizontal aria-hidden />
          </Button>
        </DropdownMenuTrigger>
      </Tooltip>
      <DropdownMenuContent
        side="top"
        align="start"
        className="w-56"
        onCloseAutoFocus={(event) => {
          const action = pending.current;
          pending.current = null;
          if (!action) return;
          event.preventDefault();
          action();
        }}
      >
        {onImportFolder && (
          <DropdownMenuItem className="gap-2 [&>svg]:size-4" onSelect={later(onImportFolder)}>
            <FileInput aria-hidden />
            {t(($) => $.notes.vault.import.menu)}
          </DropdownMenuItem>
        )}
        {onExportFolder && (
          <DropdownMenuItem className="gap-2 [&>svg]:size-4" onSelect={later(onExportFolder)}>
            <FolderOutput aria-hidden />
            {t(($) => $.notes.vault.import.export.menu)}
          </DropdownMenuItem>
        )}
        {onOpenDeadLinks && (
          <DropdownMenuItem className="gap-2 [&>svg]:size-4" onSelect={later(onOpenDeadLinks)}>
            <Link2Off aria-hidden />
            {t(($) => $.notes.linksSearch.dead.menu)}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
