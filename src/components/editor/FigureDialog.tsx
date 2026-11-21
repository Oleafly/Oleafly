import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { FigureGridSource } from "@oleafly/latex/figure-grid";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input, LITERAL_INPUT } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { useFilesStore } from "@/store/files";
import { useFigureDialogStore } from "@/store/figure-dialog";
import { suggestedFigureLabel } from "@/components/editor/figure-import";
import { ProjectImagePicker } from "@/components/editor/figure-image-picker";
import { FigureGridTab } from "@/components/editor/FigureGridTab";
import { insertFigureFromDialog, insertFigurePlaceholder } from "@/components/editor/latex-commands";
import { applyFigureEdit, writeFigureGrid } from "@/components/editor/figure-edit";
import {
  applyTypstFigureEdit,
  insertTypstFigureFromDialog,
  insertTypstFigurePlaceholder,
  projectPathForTypstReference,
  TYPST_FIGURE_PLACEMENTS,
  typstImageReference,
  type TypstFigurePlacement,
} from "@/components/editor/typst-figure";
import { sourceLanguageForPath } from "@/lib/document-engine";

type WidthChoice = "quarter" | "half" | "threeQuarters" | "full" | "custom";
type FigureLanguage = "latex" | "typst";
type FigureTab = "single" | "grid";

const WIDTH_CHOICES: readonly WidthChoice[] = ["quarter", "half", "threeQuarters", "full", "custom"];
const WIDTH_VALUES: Record<Exclude<WidthChoice, "custom">, string> = {
  quarter: String.raw`0.25\linewidth`,
  half: String.raw`0.5\linewidth`,
  threeQuarters: String.raw`0.75\linewidth`,
  full: String.raw`\linewidth`,
};
const TYPST_WIDTH_VALUES: Record<Exclude<WidthChoice, "custom">, string> = {
  quarter: "25%",
  half: "50%",
  threeQuarters: "75%",
  full: "100%",
};

function widthValues(language: FigureLanguage) {
  return language === "typst" ? TYPST_WIDTH_VALUES : WIDTH_VALUES;
}

interface FigureForm {
  width: WidthChoice;
  customWidth: string;
  captionEnabled: boolean;
  caption: string;
  labelEnabled: boolean;
  label: string;
  labelTouched: boolean;
  alt: string;
  placement: TypstFigurePlacement;
}

const INITIAL_FORM: FigureForm = {
  width: "half",
  customWidth: "",
  captionEnabled: true,
  caption: "",
  labelEnabled: true,
  label: "",
  labelTouched: false,
  alt: "",
  placement: "none",
};

export function figureWidthValue(
  form: Pick<FigureForm, "width" | "customWidth">,
  language: FigureLanguage = "latex",
): string | null {
  if (form.width !== "custom") return widthValues(language)[form.width];
  const custom = form.customWidth.trim();
  return custom === "" ? null : custom;
}

export function widthChoiceFor(
  width: string | null,
  language: FigureLanguage = "latex",
): Pick<FigureForm, "width" | "customWidth"> {
  if (width === null) return { width: "custom", customWidth: "" };
  for (const [choice, value] of Object.entries(widthValues(language))) {
    if (value === width) return { width: choice as WidthChoice, customWidth: "" };
  }
  return { width: "custom", customWidth: width };
}

function PlacementOptions({
  form,
  onChange,
}: Readonly<{ form: FigureForm; onChange: (patch: Partial<FigureForm>) => void }>) {
  const { t } = useTranslation(["common", "editor"]);
  const labels: Record<TypstFigurePlacement, string> = {
    none: t(($) => $.editor.figureDialog.placementNone),
    auto: t(($) => $.editor.figureDialog.placementAuto),
    top: t(($) => $.editor.figureDialog.placementTop),
    bottom: t(($) => $.editor.figureDialog.placementBottom),
  };
  return (
    <fieldset>
      <legend className="mb-1.5 text-xs font-medium text-muted-foreground">
        {t(($) => $.editor.figureDialog.placement)}
      </legend>
      <div className="flex flex-wrap gap-1">
        {TYPST_FIGURE_PLACEMENTS.map((placement) => (
          <Button
            key={placement}
            type="button"
            size="xs"
            variant={form.placement === placement ? "default" : "outline"}
            aria-pressed={form.placement === placement}
            data-testid={`figure-dialog-placement-${placement}`}
            onClick={() => onChange({ placement })}
          >
            {labels[placement]}
          </Button>
        ))}
      </div>
    </fieldset>
  );
}

function FigureOptions({
  form,
  onChange,
  imageOnly = false,
  language = "latex",
}: Readonly<{
  form: FigureForm;
  onChange: (patch: Partial<FigureForm>) => void;
  imageOnly?: boolean;
  language?: FigureLanguage;
}>) {
  const { t } = useTranslation(["common", "editor"]);
  const typst = language === "typst";
  const widthLabels: Record<WidthChoice, string> = {
    quarter: t(($) => $.editor.figureDialog.widthQuarter),
    half: t(($) => $.editor.figureDialog.widthHalf),
    threeQuarters: t(($) => $.editor.figureDialog.widthThreeQuarters),
    full: t(($) => $.editor.figureDialog.widthFull),
    custom: t(($) => $.editor.figureDialog.widthCustom),
  };
  return (
    <div className="space-y-4">
      <fieldset>
        <legend className="mb-1.5 text-xs font-medium text-muted-foreground">{t(($) => $.editor.figureDialog.width)}</legend>
        <div className="flex flex-wrap gap-1">
          {WIDTH_CHOICES.map((choice) => (
            <Button
              key={choice}
              type="button"
              size="xs"
              variant={form.width === choice ? "default" : "outline"}
              aria-pressed={form.width === choice}
              data-testid={`figure-dialog-width-${choice}`}
              onClick={() => onChange({ width: choice })}
            >
              {widthLabels[choice]}
            </Button>
          ))}
        </div>
        {form.width === "custom" && (
          <Input
            {...LITERAL_INPUT}
            className="mt-2 font-mono"
            value={form.customWidth}
            aria-label={t(($) => $.editor.figureDialog.customWidthLabel)}
            placeholder={
              typst
                ? t(($) => $.editor.figureDialog.customWidthPlaceholderTypst)
                : t(($) => $.editor.figureDialog.customWidthPlaceholder)
            }
            onChange={(event) => onChange({ customWidth: event.target.value })}
          />
        )}
      </fieldset>
      {imageOnly ? null : (
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <label htmlFor="figure-dialog-caption-toggle" className="text-sm">
            {t(($) => $.editor.figureDialog.captionToggle)}
          </label>
          <Switch
            id="figure-dialog-caption-toggle"
            checked={form.captionEnabled}
            onCheckedChange={(captionEnabled) => onChange({ captionEnabled })}
            aria-label={t(($) => $.editor.figureDialog.captionToggle)}
          />
        </div>
        {form.captionEnabled && (
          <Input
            value={form.caption}
            data-testid="figure-dialog-caption"
            aria-label={t(($) => $.editor.figureDialog.captionLabel)}
            placeholder={t(($) => $.editor.figureDialog.captionPlaceholder)}
            onChange={(event) => onChange({ caption: event.target.value })}
          />
        )}
      </div>
      )}
      {imageOnly ? null : (
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <label htmlFor="figure-dialog-label-toggle" className="text-sm">
            {t(($) => $.editor.figureDialog.labelToggle)}
          </label>
          <Switch
            id="figure-dialog-label-toggle"
            checked={form.labelEnabled}
            onCheckedChange={(labelEnabled) => onChange({ labelEnabled })}
            aria-label={t(($) => $.editor.figureDialog.labelToggle)}
          />
        </div>
        {form.labelEnabled && (
          <Input
            {...LITERAL_INPUT}
            className="font-mono"
            value={form.label}
            data-testid="figure-dialog-label"
            aria-label={t(($) => $.editor.figureDialog.labelLabel)}
            placeholder={t(($) => $.editor.figureDialog.labelPlaceholder)}
            onChange={(event) => onChange({ label: event.target.value, labelTouched: true })}
          />
        )}
      </div>
      )}
      {typst && (
        <div className="space-y-2">
          <label htmlFor="figure-dialog-alt" className="text-sm">
            {t(($) => $.editor.figureDialog.altLabel)}
          </label>
          <Input
            id="figure-dialog-alt"
            value={form.alt}
            data-testid="figure-dialog-alt"
            placeholder={t(($) => $.editor.figureDialog.altPlaceholder)}
            onChange={(event) => onChange({ alt: event.target.value })}
          />
        </div>
      )}
      {typst && <PlacementOptions form={form} onChange={onChange} />}
    </div>
  );
}

export function FigureDialog() {
  const { t } = useTranslation(["common", "editor"]);
  const open = useFigureDialogStore((state) => state.open);
  const edit = useFigureDialogStore((state) => state.edit);
  const setOpen = useFigureDialogStore((state) => state.setOpen);
  const [selected, setSelected] = useState<string | null>(null);
  const [form, setForm] = useState<FigureForm>(INITIAL_FORM);
  const [tab, setTab] = useState<FigureTab>("single");
  const [language, setLanguage] = useState<FigureLanguage>("latex");
  const [filePath, setFilePath] = useState<string | null>(null);
  const insertedRef = useRef(false);

  useEffect(() => {
    if (!open) return;
    const activePath = useFilesStore.getState().activePath;
    const typst = edit ? Boolean(edit.typst) : sourceLanguageForPath(activePath) === "typst";
    setLanguage(typst ? "typst" : "latex");
    setFilePath(activePath);
    if (edit?.typst) {
      const fields = edit.typst;
      setSelected(projectPathForTypstReference(fields.path, activePath));
      setForm({
        ...INITIAL_FORM,
        ...widthChoiceFor(fields.width, "typst"),
        captionEnabled: fields.caption !== null,
        caption: fields.caption ?? "",
        labelEnabled: fields.label !== null,
        label: fields.label ?? "",
        labelTouched: true,
        alt: fields.alt ?? "",
        placement: fields.placement,
      });
    } else {
      setSelected(edit?.path ?? null);
      setForm(edit ? { ...INITIAL_FORM, ...widthChoiceFor(edit.width) } : INITIAL_FORM);
    }
    setTab(edit?.grid ? "grid" : "single");
    insertedRef.current = false;
  }, [open, edit]);

  const patch = (changes: Partial<FigureForm>) => setForm((current) => ({ ...current, ...changes }));

  const choose = (path: string) => {
    setSelected(path);
    setForm((current) => (current.labelTouched ? current : { ...current, label: suggestedFigureLabel(path) }));
  };

  const typstVersion = () => useFilesStore.getState().engine.typst_resolved?.version ?? null;

  const insertTypst = (path: string) => {
    const caption = form.captionEnabled ? form.caption : null;
    const label = form.labelEnabled && form.label.trim() !== "" ? form.label.trim() : null;
    const alt = form.alt.trim() === "" ? null : form.alt.trim();
    const width = figureWidthValue(form, "typst");
    setOpen(false);
    const fields = edit?.typst;
    if (edit && fields) {
      const unchanged = projectPathForTypstReference(fields.path, filePath) === path;
      applyTypstFigureEdit(
        edit,
        {
          ...fields,
          path: unchanged ? fields.path : typstImageReference(path, filePath),
          width,
          caption,
          label,
          alt,
          placement: form.placement,
        },
        typstVersion(),
      );
      return;
    }
    insertTypstFigureFromDialog({ path, width, caption, label, alt, placement: form.placement }, filePath, typstVersion());
  };

  const insert = () => {
    if (!selected) return;
    insertedRef.current = true;
    if (language === "typst") {
      insertTypst(selected);
      return;
    }
    if (edit) {
      setOpen(false);
      applyFigureEdit(edit, { path: selected, width: figureWidthValue(form) });
      return;
    }
    setOpen(false);
    insertFigureFromDialog({
      path: selected,
      width: figureWidthValue(form),
      caption: form.captionEnabled ? form.caption : null,
      label: form.labelEnabled && form.label.trim() !== "" ? form.label.trim() : null,
    });
  };

  const placeholder = () => {
    insertedRef.current = true;
    setOpen(false);
    if (language === "typst") insertTypstFigurePlaceholder();
    else insertFigurePlaceholder();
  };

  const submitGrid = (grid: FigureGridSource) => {
    insertedRef.current = true;
    setOpen(false);
    void writeFigureGrid(grid, edit?.grid ? { from: edit.from, to: edit.to } : null);
  };

  const typstEdit = edit !== null && language === "typst";
  const gridView = edit?.grid !== undefined || (edit === null && language === "latex" && tab === "grid");
  let title = t(($) => $.editor.figureDialog.title);
  let description = t(($) => $.editor.figureDialog.description);
  let saveLabel = t(($) => $.editor.figureDialog.insert);
  if (edit?.grid) {
    title = t(($) => $.editor.figureDialog.gridEditTitle);
    description = t(($) => $.editor.figureDialog.gridEditDescription);
  } else if (gridView) {
    description = t(($) => $.editor.figureDialog.gridDescription);
  } else if (typstEdit) {
    title = t(($) => $.editor.figureDialog.editFigureTitle);
    description = t(($) => $.editor.figureDialog.editFigureDescription);
    saveLabel = t(($) => $.editor.figureDialog.saveFigure);
  } else if (edit) {
    title = t(($) => $.editor.figureDialog.editTitle);
    description = t(($) => $.editor.figureDialog.editDescription);
    saveLabel = t(($) => $.editor.figureDialog.save);
  }

  const single = (
    <>
      <div className="grid gap-5 px-5 py-4 sm:grid-cols-[minmax(0,1fr)_15rem]">
        <section className="min-w-0">
          <ProjectImagePicker
            selected={selected ? [selected] : []}
            multiple={false}
            testId="figure-dialog"
            onChoose={choose}
            onImported={(paths) => choose(paths[0])}
          />
        </section>
        <FigureOptions
          form={form}
          onChange={patch}
          imageOnly={edit !== null && language !== "typst"}
          language={language}
        />
      </div>
      <DialogFooter className="border-t px-5 py-3 sm:justify-between">
        {edit ? (
          <span />
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-testid="figure-dialog-placeholder"
            onClick={placeholder}
          >
            {t(($) => $.editor.figureDialog.insertPlaceholder)}
          </Button>
        )}
        <div className="flex items-center gap-2">
          {!selected && (
            <span className="text-xs text-muted-foreground">{t(($) => $.editor.figureDialog.selectImage)}</span>
          )}
          <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>
            {t(($) => $.editor.figureDialog.cancel)}
          </Button>
          <Button type="button" size="sm" disabled={!selected} data-testid="figure-dialog-insert" onClick={insert}>
            {saveLabel}
          </Button>
        </div>
      </DialogFooter>
    </>
  );
  const grid = (
    <FigureGridTab spec={edit?.grid ?? null} onCancel={() => setOpen(false)} onSubmit={submitGrid} />
  );
  let content = single;
  if (edit?.grid) content = grid;
  else if (edit === null && language === "latex") {
    content = (
      <Tabs value={tab} onValueChange={(value) => setTab(value === "grid" ? "grid" : "single")}>
        <div className="px-5 pt-3">
          <TabsList size="sm">
            <TabsTrigger value="single">{t(($) => $.editor.figureDialog.tabSingle)}</TabsTrigger>
            <TabsTrigger value="grid" data-testid="figure-grid-tab">
              {t(($) => $.editor.figureDialog.tabGrid)}
            </TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="single">{single}</TabsContent>
        <TabsContent value="grid">{grid}</TabsContent>
      </Tabs>
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        data-testid="figure-dialog"
        className={cn("max-w-2xl gap-0 p-0", gridView && "max-w-3xl")}
        onCloseAutoFocus={(event) => {
          if (insertedRef.current) event.preventDefault();
        }}
      >
        <DialogHeader className="border-b px-5 py-4 pr-12">
          <DialogTitle className="text-sm leading-tight">{title}</DialogTitle>
          <DialogDescription className="text-xs">{description}</DialogDescription>
        </DialogHeader>
        {content}
      </DialogContent>
    </Dialog>
  );
}
