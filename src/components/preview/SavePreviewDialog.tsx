import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useModalAccessibility } from "@/components/ui/use-modal-accessibility";

export function SavePreviewDialog({ saveOpen, closeSave, isImage = false, pdfIsStale, saveName, setSaveName, saving, hasDocument, submitSavePdf }: Readonly<{
  saveOpen: boolean;
  closeSave: () => void;
  isImage?: boolean;
  pdfIsStale: boolean;
  saveName: string;
  setSaveName: (value: string) => void;
  saving: boolean;
  hasDocument: boolean;
  submitSavePdf: () => void;
}>) {
  const { t } = useTranslation(["common", "preview"]);
  const { dialogRef: saveDialogRef, onBackdropMouseDown: onSaveBackdropMouseDown } =
    useModalAccessibility<HTMLDivElement>(saveOpen, closeSave);
  return (
    saveOpen && (
      <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
        <button type="button" aria-label={t(($) => $.preview.save.close)} className="absolute inset-0" onMouseDown={onSaveBackdropMouseDown} />
        <div
          ref={saveDialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="save-preview-title"
          tabIndex={-1}
          className="relative w-full max-w-sm rounded-xl border bg-popover p-5 text-popover-foreground shadow-2xl"
        >
          <div className="mb-3 flex items-center justify-between">
            <h2 id="save-preview-title" className="text-sm font-semibold">
              {isImage
                ? t(($) => $.preview.save.imageTitle)
                : t(($) => $.preview.save.title)}
            </h2>
            <button
              type="button"
              onClick={closeSave}
              aria-label={t(($) => $.preview.save.close)}
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          </div>
          <p className="mb-3 text-xs text-muted-foreground">
            {pdfIsStale
              ? t(($) => $.preview.save.staleDescription)
              : t(($) => $.preview.save.description)}
          </p>
          <div className="flex items-center gap-2">
            <Input
              data-modal-initial-focus
              aria-label={t(($) => $.preview.save.nameLabel)}
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !saving) submitSavePdf(); }}
              placeholder={t(($) => $.preview.save.namePlaceholder)}
              className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
            <Button
              onClick={() => void submitSavePdf()}
              disabled={saving || !hasDocument}
            >
              {saving
                ? t(($) => $.common.state.saving)
                : t(($) => $.common.actions.save)}
            </Button>
          </div>
        </div>
      </div>
    )
  );

}
