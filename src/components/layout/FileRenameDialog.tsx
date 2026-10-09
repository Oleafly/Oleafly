import { useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ModalShell } from "@/components/ui/modal-shell";
import { normalizeRenameDestination, renameFromPrompt } from "@/lib/file-references/rename-at-cursor";
import { cn } from "@/lib/utils";
import { type FileRenameTarget, useFileRenameStore } from "@/store/file-rename";

function nameRange(target: FileRenameTarget): [number, number] {
  const start = target.path.lastIndexOf("/") + 1;
  const dot = target.directory ? -1 : target.path.lastIndexOf(".");
  return [start, dot > start ? dot : target.path.length];
}

function FileRenameForm({ target, onClose }: Readonly<{ target: FileRenameTarget; onClose: () => void }>) {
  const { t } = useTranslation(["common", "shell"]);
  const [value, setValue] = useState(target.path);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const selected = useRef(false);
  const titleId = useId();
  const hintId = useId();
  const destination = normalizeRenameDestination(value);
  const canSubmit = !busy && destination !== null && destination !== target.path;
  const message = error ?? (value.trim() && destination === null ? t(($) => $.shell.fileRenameDialog.invalid) : null);

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    const result = await renameFromPrompt(target.path, value);
    if (result.status === "exists") {
      setError(t(($) => $.shell.fileRenameDialog.exists, { path: result.path }));
      setBusy(false);
      return;
    }
    if (result.status === "invalid") {
      setError(t(($) => $.shell.fileRenameDialog.invalid));
      setBusy(false);
      return;
    }
    onClose();
  };

  return (
    <ModalShell
      open
      onClose={onClose}
      closeLabel={t(($) => $.shell.renameDialog.close)}
      align="top"
      labelledBy={titleId}
      className="w-[28rem] max-w-[90vw] p-4"
      testId="file-rename-dialog"
    >
      <p id={titleId} className="text-sm font-semibold">
        {target.directory
          ? t(($) => $.shell.fileRenameDialog.titleFolder)
          : t(($) => $.shell.fileRenameDialog.title)}
      </p>
      <Input
        data-modal-initial-focus
        aria-label={t(($) => $.shell.fileRenameDialog.newPath)}
        aria-describedby={hintId}
        aria-invalid={message ? true : undefined}
        spellCheck={false}
        value={value}
        disabled={busy}
        onFocus={(event) => {
          if (selected.current) return;
          selected.current = true;
          event.currentTarget.setSelectionRange(...nameRange(target));
        }}
        onChange={(event) => {
          setValue(event.target.value);
          setError(null);
        }}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          void submit();
        }}
        className="mt-2 font-mono text-xs"
      />
      <p
        id={hintId}
        className={cn("mt-2 min-h-4 text-[0.6875rem]", message ? "text-destructive" : "text-muted-foreground")}
      >
        {message ?? t(($) => $.shell.fileRenameDialog.hint)}
      </p>
      <div className="mt-3 flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onClose}>
          {t(($) => $.common.actions.cancel)}
        </Button>
        <Button size="sm" onClick={() => void submit()} disabled={!canSubmit}>
          {t(($) => $.common.actions.rename)}
        </Button>
      </div>
    </ModalShell>
  );
}

export function FileRenameDialog() {
  const target = useFileRenameStore((state) => state.target);
  const close = useFileRenameStore((state) => state.close);
  if (!target) return null;
  return <FileRenameForm key={target.path} target={target} onClose={close} />;
}
