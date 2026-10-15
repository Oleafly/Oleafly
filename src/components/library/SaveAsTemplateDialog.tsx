import { useEffect, useId, useRef, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { LayoutTemplate, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ModalShell } from "@/components/ui/modal-shell";
import { Spinner } from "@/components/ui/spinner";
import { announceSavedTemplate, saveProjectTemplate } from "@/features/custom-templates";
import { decodeAppError, describeError } from "@/lib/app-error";
import { logError } from "@/lib/log";
import { useSaveAsTemplateStore } from "@/store/save-as-template";

/**
 * Save a project's files as a template under Custom. Opened from a library
 * project's menu or the toolbar's Export menu; mounted once per app shell.
 */
export function SaveAsTemplateDialog() {
  const { t } = useTranslation(["common", "library"]);
  const target = useSaveAsTemplateStore((state) => state.target);
  const close = useSaveAsTemplateStore((state) => state.close);
  // Seeded from the project so a dialog mounted for it never shows an empty name.
  const [name, setName] = useState(() => target?.name ?? "");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const titleId = useId();
  const nameId = useId();

  useEffect(() => {
    setName(target?.name ?? "");
    setError(null);
  }, [target]);

  const dismiss = () => {
    if (!busyRef.current) close();
  };

  const save = async () => {
    const current = target;
    const templateName = name.trim();
    if (!current || !templateName || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const id = await saveProjectTemplate(current.projectId, templateName);
      close();
      announceSavedTemplate(id, templateName);
    } catch (error_) {
      void logError("save project as template", error_);
      setError(
        decodeAppError(error_)
          ? describeError(error_)
          : t(($) => $.library.customTemplates.saveFailed),
      );
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  return (
    <ModalShell
      open={target !== null}
      onClose={dismiss}
      closeLabel={t(($) => $.common.actions.close)}
      width="md"
      layer="nested"
      portal
      labelledBy={titleId}
      testId="save-as-template-dialog"
      className="p-5"
    >
      <div className="mb-4 flex items-center justify-between">
        <h2 id={titleId} className="text-base font-semibold">
          {t(($) => $.library.customTemplates.saveTitle)}
        </h2>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          disabled={busy}
          onClick={dismiss}
          aria-label={t(($) => $.common.actions.close)}
        >
          <X className="size-4" />
        </Button>
      </div>
      <p className="mb-3 text-xs text-muted-foreground [overflow-wrap:anywhere]">
        <Trans
          ns="library"
          i18nKey={($) => $.library.customTemplates.saveDescription}
          values={{ name: target?.name ?? "" }}
          components={{ name: <span className="font-medium text-foreground" /> }}
        />
      </p>
      {error ? (
        <p
          role="alert"
          className="mb-3 select-text rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
        >
          {error}
        </p>
      ) : null}
      <label htmlFor={nameId} className="mb-1.5 block text-xs font-medium text-muted-foreground">
        {t(($) => $.library.customTemplates.nameLabel)}
      </label>
      <div className="flex items-center gap-2">
        <Input
          id={nameId}
          data-modal-initial-focus
          data-testid="save-as-template-name"
          value={name}
          maxLength={120}
          disabled={busy}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void save();
          }}
          className="flex-1"
        />
        <Button
          data-testid="save-as-template-save"
          onClick={() => void save()}
          disabled={busy || !name.trim()}
        >
          {busy ? <Spinner /> : <LayoutTemplate className="size-4" />}
          {busy
            ? t(($) => $.library.customTemplates.saving)
            : t(($) => $.library.customTemplates.save)}
        </Button>
      </div>
    </ModalShell>
  );
}
