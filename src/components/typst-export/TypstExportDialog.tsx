import { useEffect, useId, useMemo, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { I18nextProvider, useTranslation } from "react-i18next";
import { ImageDown } from "lucide-react";
import { create } from "zustand";
import type { TypstOptionsDescriptor } from "@oleafly/backend-port";
import { i18n } from "@/i18n";
import { ModalShell } from "@/components/ui/modal-shell";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { exportCurrentTypst } from "@/features/export";
import {
  typstHtmlExport,
  typstSupports,
  validTypstPageRanges,
  type TypstExportFormat,
  type TypstExportRequest,
} from "@/lib/typst-options";
import { useFilesStore } from "@/store/files";

const TITLE_ID = "typst-export-title";
const PPI_CHOICES = [72, 144, 300, 600] as const;
const DEFAULT_PPI = 144;

type ImageFormat = Exclude<TypstExportFormat, "pdf">;

export function typstExportFormats(options: TypstOptionsDescriptor | null | undefined): ImageFormat[] {
  const formats: ImageFormat[] = [];
  if (options?.output_formats.includes("png")) formats.push("png");
  if (options?.output_formats.includes("svg")) formats.push("svg");
  if (typstHtmlExport(options)) formats.push("html");
  return formats;
}

export function typstExportRequest(
  format: ImageFormat,
  ppi: number,
  pages: string,
  options: TypstOptionsDescriptor | null | undefined,
): TypstExportRequest | null {
  const usesPages = format !== "html" && typstSupports(options, "--pages") && pages.trim() !== "";
  if (usesPages && !validTypstPageRanges(pages)) return null;
  return {
    format,
    ...(format === "png" ? { ppi } : {}),
    ...(usesPages ? { pages: pages.trim() } : {}),
  };
}

export function TypstExportDialog({ open, onClose }: Readonly<{ open: boolean; onClose: () => void }>) {
  const { t } = useTranslation(["shell"]);
  const options = useFilesStore((state) => state.engine.typst_options ?? null);
  const formats = useMemo(() => typstExportFormats(options), [options]);
  const [format, setFormat] = useState<ImageFormat>("png");
  const [ppi, setPpi] = useState<number>(DEFAULT_PPI);
  const [pages, setPages] = useState("");
  const [pagesInvalid, setPagesInvalid] = useState(false);
  const pagesId = useId();
  const formatId = useId();
  const pagesHelpId = useId();

  useEffect(() => {
    if (open && formats.length > 0 && !formats.includes(format)) setFormat(formats[0]);
  }, [open, formats, format]);

  const canPickPages = format !== "html" && typstSupports(options, "--pages");

  const submit = () => {
    const request = typstExportRequest(format, ppi, pages, options);
    if (!request) {
      setPagesInvalid(true);
      return;
    }
    onClose();
    void exportCurrentTypst(request);
  };

  const formatLabel = (value: ImageFormat) => {
    if (value === "png") return t(($) => $.shell.typstExport.png);
    if (value === "svg") return t(($) => $.shell.typstExport.svg);
    return t(($) => $.shell.typstExport.html);
  };

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      closeLabel={t(($) => $.shell.typstExport.close)}
      portal
      labelledBy={TITLE_ID}
      className="flex w-[26rem] max-w-[92vw] flex-col"
    >
      <div className="flex items-center gap-2 border-b px-3 py-2.5">
        <ImageDown aria-hidden="true" className="size-4 text-muted-foreground" />
        <span id={TITLE_ID} className="text-sm font-semibold">
          {t(($) => $.shell.typstExport.title)}
        </span>
      </div>
      <div className="flex flex-col gap-4 p-3">
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1.5 text-xs font-medium">{t(($) => $.shell.typstExport.format)}</legend>
          <RadioGroup value={format} onValueChange={(value) => setFormat(value as ImageFormat)}>
            {formats.map((value) => (
              <div key={value} className="flex items-center gap-2 text-sm">
                <RadioGroupItem
                  id={`${formatId}-${value}`}
                  value={value}
                  data-testid={`typst-export-${value}`}
                  data-modal-initial-focus={value === formats[0] || undefined}
                />
                <label htmlFor={`${formatId}-${value}`} className="cursor-pointer">
                  {formatLabel(value)}
                </label>
                {value === "html" && (
                  <Badge variant="muted" size="sm">
                    {t(($) => $.shell.typstExport.experimental)}
                  </Badge>
                )}
              </div>
            ))}
          </RadioGroup>
          {format === "html" && (
            <p className="text-[11px] text-muted-foreground">{t(($) => $.shell.typstExport.htmlNote)}</p>
          )}
        </fieldset>
        {format === "png" && (
          <div className="flex items-center gap-3">
            <span className="text-xs font-medium">{t(($) => $.shell.typstExport.ppi)}</span>
            <Select value={String(ppi)} onValueChange={(value) => setPpi(Number(value))}>
              <SelectTrigger className="h-8 w-32 text-xs" aria-label={t(($) => $.shell.typstExport.ppi)}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PPI_CHOICES.map((choice) => (
                  <SelectItem key={choice} value={String(choice)}>
                    {t(($) => $.shell.typstExport.ppiValue, { ppi: choice })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        {format !== "html" && (
          <div className="flex flex-col gap-1.5">
            <label htmlFor={pagesId} className="text-xs font-medium">
              {t(($) => $.shell.typstExport.pages)}
            </label>
            {canPickPages ? (
              <>
                <Input
                  id={pagesId}
                  value={pages}
                  onChange={(event) => {
                    setPages(event.target.value);
                    setPagesInvalid(false);
                  }}
                  placeholder={t(($) => $.shell.typstExport.pagesPlaceholder)}
                  aria-describedby={pagesHelpId}
                  aria-invalid={pagesInvalid || undefined}
                  maxLength={200}
                  className="h-8 text-sm"
                  data-testid="typst-export-pages"
                />
                <p
                  id={pagesHelpId}
                  role={pagesInvalid ? "alert" : undefined}
                  className={pagesInvalid ? "text-[11px] text-destructive" : "text-[11px] text-muted-foreground"}
                >
                  {pagesInvalid
                    ? t(($) => $.shell.typstExport.pagesInvalid)
                    : t(($) => $.shell.typstExport.pagesHelp)}
                </p>
              </>
            ) : (
              <p className="text-[11px] text-muted-foreground">{t(($) => $.shell.typstExport.pagesUnsupported)}</p>
            )}
            <p className="text-[11px] text-muted-foreground">{t(($) => $.shell.typstExport.multiPage)}</p>
          </div>
        )}
      </div>
      <div className="flex items-center justify-end gap-2 border-t px-3 py-2.5">
        <Button type="button" size="sm" variant="ghost" onClick={onClose}>
          {t(($) => $.shell.typstExport.cancel)}
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={formats.length === 0}
          onClick={submit}
          data-testid="typst-export-submit"
        >
          {t(($) => $.shell.typstExport.export)}
        </Button>
      </div>
    </ModalShell>
  );
}

const useDialogOpen = create<{ open: boolean; setOpen: (open: boolean) => void }>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));

function TypstExportDialogHost() {
  const open = useDialogOpen((state) => state.open);
  const setOpen = useDialogOpen((state) => state.setOpen);
  return <TypstExportDialog open={open} onClose={() => setOpen(false)} />;
}

let root: Root | null = null;

export function showTypstExportDialog(): void {
  if (!root) {
    const container = document.createElement("div");
    container.dataset.typstExport = "";
    document.body.append(container);
    root = createRoot(container);
    root.render(
      <I18nextProvider i18n={i18n}>
        <TypstExportDialogHost />
      </I18nextProvider>,
    );
  }
  useDialogOpen.getState().setOpen(true);
}
