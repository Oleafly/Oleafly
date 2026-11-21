import { type KeyboardEvent, type PointerEvent, useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ImageOff } from "lucide-react";
import {
  type FigureGridRect,
  type FigureGridSource,
  type FigureGridSpec,
  type FigureGridWidth,
  type FigureGridZoom,
  type FigureGridZoomPlacement,
  figureGridColumns,
  figureGridRect,
  figureGridSource,
} from "@oleafly/latex/figure-grid";
import { latexColorToCss } from "@oleafly/latex";
import { Button } from "@/components/ui/button";
import { CodeBlock } from "@/components/ui/code-block";
import { ColorSwatch } from "@/components/ui/color-swatch";
import { DialogFooter } from "@/components/ui/dialog";
import { Input, LITERAL_INPUT } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { latexGraphicsPath, suggestedFigureLabel } from "@/components/editor/figure-import";
import { ProjectImagePicker, useAssetUrl } from "@/components/editor/figure-image-picker";
import { TEXT_COLORS } from "@/components/editor/rich-text-controls";
import { cn } from "@/lib/utils";
import { useFilesStore } from "@/store/files";

const MAX_COLUMNS = 6;
const DEFAULT_RECT: FigureGridRect = { x: 0.35, y: 0.35, w: 0.3, h: 0.3 };
const ZOOM_COLORS = TEXT_COLORS.filter((color) => color.id !== "gray");
const WIDTHS: readonly FigureGridWidth[] = ["column", "page"];
const PLACEMENTS: readonly FigureGridZoomPlacement[] = ["right", "below"];
const NUDGES = new Map<string, readonly [number, number]>([
  ["ArrowLeft", [-0.02, 0]],
  ["ArrowRight", [0.02, 0]],
  ["ArrowUp", [0, -0.02]],
  ["ArrowDown", [0, 0.02]],
]);

interface GridForm {
  selected: string[];
  aspects: Record<string, number>;
  columns: number;
  columnLabels: string[];
  rowLabels: string[];
  width: FigureGridWidth;
  zoom: boolean;
  rect: FigureGridRect;
  placement: FigureGridZoomPlacement;
  color: string;
  caption: string;
  label: string;
  labelTouched: boolean;
}

function initialForm(spec: FigureGridSpec | null): GridForm {
  const images = spec?.images.flat() ?? [];
  return {
    selected: images.map((image) => image.path),
    aspects: Object.fromEntries(images.map((image) => [image.path, image.aspect])),
    columns: spec ? figureGridColumns(spec) : 3,
    columnLabels: spec?.columnLabels ?? [],
    rowLabels: spec?.rowLabels ?? [],
    width: spec?.width ?? "column",
    zoom: spec?.zoom !== undefined,
    rect: spec?.zoom?.rect ?? DEFAULT_RECT,
    placement: spec?.zoom?.placement ?? "right",
    color: spec?.zoom?.color ?? ZOOM_COLORS[0].spec,
    caption: spec?.caption ?? "",
    label: spec?.label ?? "",
    labelTouched: spec !== null,
  };
}

function gridColumns(form: GridForm): number {
  return form.selected.length === 0 ? form.columns : Math.min(form.columns, form.selected.length);
}

function gridSpec(form: GridForm): FigureGridSpec {
  const columns = gridColumns(form);
  const images: FigureGridSpec["images"] = [];
  form.selected.forEach((path, index) => {
    if (index % columns === 0) images.push([]);
    images.at(-1)?.push({ path, aspect: form.aspects[path] ?? 1 });
  });
  const zoom: FigureGridZoom = { rect: form.rect, placement: form.placement, color: form.color };
  return {
    images,
    columnLabels: Array.from({ length: columns }, (_, index) => form.columnLabels[index] ?? ""),
    rowLabels: images.map((_, index) => form.rowLabels[index] ?? ""),
    ...(form.zoom ? { zoom } : {}),
    width: form.width,
    caption: form.caption,
    label: form.label,
  };
}

function withLabel(labels: readonly string[], index: number, value: string): string[] {
  const next = [...labels];
  while (next.length <= index) next.push("");
  next[index] = value;
  return next;
}

function ZoomBox({ rect, color, className }: Readonly<{ rect: FigureGridRect; color: string; className: string }>) {
  return (
    <span
      aria-hidden
      className={cn("pointer-events-none absolute", className)}
      style={{
        left: `${rect.x * 100}%`,
        top: `${rect.y * 100}%`,
        width: `${rect.w * 100}%`,
        height: `${rect.h * 100}%`,
        borderColor: latexColorToCss(color) ?? undefined,
      }}
    />
  );
}

function ZoomArea({
  path,
  rect,
  color,
  hintId,
  onChange,
}: Readonly<{ path: string; rect: FigureGridRect; color: string; hintId: string; onChange: (rect: FigureGridRect) => void }>) {
  const { t } = useTranslation(["editor"]);
  const url = useAssetUrl(path);
  const image = useRef<HTMLImageElement>(null);
  const start = useRef<{ x: number; y: number } | null>(null);

  const pointAt = (event: PointerEvent<HTMLElement>) => {
    const box = image.current?.getBoundingClientRect();
    if (!box || box.width <= 0 || box.height <= 0) return null;
    return { x: (event.clientX - box.left) / box.width, y: (event.clientY - box.top) / box.height };
  };

  const down = (event: PointerEvent<HTMLButtonElement>) => {
    const point = event.button === 0 ? pointAt(event) : null;
    if (!point) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    start.current = point;
    onChange(figureGridRect(point, point));
  };

  const move = (event: PointerEvent<HTMLButtonElement>) => {
    const origin = start.current;
    const point = origin ? pointAt(event) : null;
    if (origin && point) onChange(figureGridRect(origin, point));
  };

  const finish = (event: PointerEvent<HTMLButtonElement>) => {
    move(event);
    start.current = null;
  };

  const cancel = () => {
    start.current = null;
  };

  const nudge = (event: KeyboardEvent<HTMLButtonElement>) => {
    const step = NUDGES.get(event.key);
    if (!step) return;
    event.preventDefault();
    const x = Math.min(1 - rect.w, Math.max(0, rect.x + step[0]));
    const y = Math.min(1 - rect.h, Math.max(0, rect.y + step[1]));
    onChange(figureGridRect({ x, y }, { x: x + rect.w, y: y + rect.h }));
  };

  return (
    <button
      type="button"
      aria-label={t(($) => $.editor.figureDialog.gridZoomArea)}
      aria-describedby={hintId}
      data-testid="figure-grid-zoom-area"
      className="relative inline-block max-w-full cursor-crosshair touch-none select-none rounded border border-border p-0 focus-visible:border-primary"
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={finish}
      onPointerCancel={cancel}
      onKeyDown={nudge}
    >
      {url ? (
        <img ref={image} src={url} alt="" draggable={false} className="block max-h-64 max-w-full" />
      ) : (
        <span className="flex h-32 w-48 items-center justify-center">
          <ImageOff className="size-5 text-muted-foreground" aria-label={t(($) => $.editor.figureDialog.noPreview)} />
        </span>
      )}
      <ZoomBox rect={rect} color={color} className="border-2" />
    </button>
  );
}

function GridCell({
  path,
  aspect,
  zoom,
  onAspect,
}: Readonly<{ path: string; aspect: number; zoom: FigureGridZoom | null; onAspect: (path: string, aspect: number) => void }>) {
  const { t } = useTranslation(["editor"]);
  const url = useAssetUrl(path);
  if (!url) {
    return (
      <div data-testid="figure-grid-cell" data-path={path} className="flex h-16 items-center justify-center rounded bg-muted/40">
        <ImageOff className="size-4 text-muted-foreground" aria-label={t(($) => $.editor.figureDialog.noPreview)} />
      </div>
    );
  }
  const image = (
    <span className="relative block min-w-0" style={zoom?.placement === "right" ? { flex: "1 1 0" } : undefined}>
      <img
        src={url}
        alt={t(($) => $.editor.figureDialog.thumbnailAlt, { path })}
        className="block w-full"
        onLoad={(event) => {
          const { naturalWidth, naturalHeight } = event.currentTarget;
          if (naturalWidth > 0 && naturalHeight > 0) onAspect(path, naturalWidth / naturalHeight);
        }}
      />
      {zoom ? <ZoomBox rect={zoom.rect} color={zoom.color} className="border" /> : null}
    </span>
  );
  if (!zoom) {
    return (
      <div data-testid="figure-grid-cell" data-path={path}>
        {image}
      </div>
    );
  }
  const { x, y, w, h } = zoom.rect;
  const right = zoom.placement === "right";
  return (
    <div data-testid="figure-grid-cell" data-path={path} className={cn("flex gap-0.5", right ? "items-start" : "flex-col items-center")}>
      {image}
      <span
        className="relative block min-w-0 overflow-hidden border"
        style={{
          aspectRatio: `${w * aspect} / ${h}`,
          borderColor: latexColorToCss(zoom.color) ?? undefined,
          ...(right ? { flex: `${Math.min(1, w / h)} 1 0` } : { width: `${Math.min(1, w / h) * 100}%` }),
        }}
      >
        <img
          src={url}
          alt=""
          className="absolute max-w-none"
          style={{ width: `${100 / w}%`, left: `${(-x / w) * 100}%`, top: `${(-y / h) * 100}%` }}
        />
      </span>
    </div>
  );
}

function Legend({ children }: Readonly<{ children: string }>) {
  return <legend className="mb-1.5 text-xs font-medium text-muted-foreground">{children}</legend>;
}

function GridOptions({
  form,
  rows,
  hintId,
  onChange,
}: Readonly<{ form: GridForm; rows: number; hintId: string; onChange: (patch: Partial<GridForm>) => void }>) {
  const { t } = useTranslation(["common", "editor"]);
  const columns = gridColumns(form);
  const widthLabels: Record<FigureGridWidth, string> = {
    column: t(($) => $.editor.figureDialog.gridWidthColumn),
    page: t(($) => $.editor.figureDialog.gridWidthPage),
  };
  const placementLabels: Record<FigureGridZoomPlacement, string> = {
    right: t(($) => $.editor.figureDialog.gridZoomBeside),
    below: t(($) => $.editor.figureDialog.gridZoomBelow),
  };
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <label htmlFor="figure-grid-columns" className="text-sm">
          {t(($) => $.editor.figureDialog.gridColumns)}
        </label>
        <Input
          id="figure-grid-columns"
          data-testid="figure-grid-columns"
          type="number"
          min={1}
          max={MAX_COLUMNS}
          value={form.columns}
          onChange={(event) => onChange({ columns: Math.max(1, Math.min(MAX_COLUMNS, Number(event.target.value) || 1)) })}
          className="h-8 w-16"
        />
      </div>
      <fieldset>
        <Legend>{t(($) => $.editor.figureDialog.width)}</Legend>
        <div className="flex flex-wrap gap-1">
          {WIDTHS.map((width) => (
            <Button
              key={width}
              type="button"
              size="xs"
              variant={form.width === width ? "default" : "outline"}
              aria-pressed={form.width === width}
              data-testid={`figure-grid-width-${width}`}
              onClick={() => onChange({ width })}
            >
              {widthLabels[width]}
            </Button>
          ))}
        </div>
      </fieldset>
      <fieldset className="space-y-1.5">
        <Legend>{t(($) => $.editor.figureDialog.gridColumnHeaders)}</Legend>
        {Array.from({ length: columns }, (_, index) => (
          <Input
            // biome-ignore lint/suspicious/noArrayIndexKey: a header belongs to its column position in the grid
            key={index}
            className="h-8"
            value={form.columnLabels[index] ?? ""}
            data-testid={`figure-grid-column-label-${index}`}
            aria-label={t(($) => $.editor.figureDialog.gridColumnHeader, { index: index + 1 })}
            placeholder={t(($) => $.editor.figureDialog.gridColumnHeaderPlaceholder, { letter: String.fromCodePoint(97 + index) })}
            onChange={(event) => onChange({ columnLabels: withLabel(form.columnLabels, index, event.target.value) })}
          />
        ))}
      </fieldset>
      {rows > 0 ? (
        <fieldset className="space-y-1.5">
          <Legend>{t(($) => $.editor.figureDialog.gridRowLabels)}</Legend>
          {Array.from({ length: rows }, (_, index) => (
            <Input
              // biome-ignore lint/suspicious/noArrayIndexKey: a row label belongs to its row position in the grid
              key={index}
              className="h-8"
              value={form.rowLabels[index] ?? ""}
              data-testid={`figure-grid-row-label-${index}`}
              aria-label={t(($) => $.editor.figureDialog.gridRowLabel, { index: index + 1 })}
              placeholder={t(($) => $.editor.figureDialog.gridRowLabelPlaceholder, { index: index + 1 })}
              onChange={(event) => onChange({ rowLabels: withLabel(form.rowLabels, index, event.target.value) })}
            />
          ))}
        </fieldset>
      ) : null}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <label htmlFor="figure-grid-zoom" className="text-sm">
            {t(($) => $.editor.figureDialog.gridZoomToggle)}
          </label>
          <Switch
            id="figure-grid-zoom"
            data-testid="figure-grid-zoom"
            checked={form.zoom}
            onCheckedChange={(zoom) => onChange({ zoom })}
          />
        </div>
        {form.zoom ? (
          <>
            <p id={hintId} className="text-xs text-muted-foreground">
              {t(($) => $.editor.figureDialog.gridZoomHint)}
            </p>
            <div className="flex flex-wrap gap-1">
              {PLACEMENTS.map((placement) => (
                <Button
                  key={placement}
                  type="button"
                  size="xs"
                  variant={form.placement === placement ? "default" : "outline"}
                  aria-pressed={form.placement === placement}
                  data-testid={`figure-grid-zoom-${placement}`}
                  onClick={() => onChange({ placement })}
                >
                  {placementLabels[placement]}
                </Button>
              ))}
            </div>
            <fieldset>
              <Legend>{t(($) => $.editor.figureDialog.gridZoomColor)}</Legend>
              <div className="flex flex-wrap gap-1.5">
                {ZOOM_COLORS.map((color) => (
                  <ColorSwatch
                    key={color.id}
                    size="sm"
                    color={latexColorToCss(color.spec) ?? color.spec}
                    name={t(($) => $.editor.toolbar.textColors[color.id])}
                    pressed={form.color === color.spec}
                    data-testid={`figure-grid-zoom-color-${color.id}`}
                    onClick={() => onChange({ color: color.spec })}
                  />
                ))}
              </div>
            </fieldset>
          </>
        ) : null}
      </div>
      <Input
        value={form.caption}
        data-testid="figure-grid-caption"
        aria-label={t(($) => $.editor.figureDialog.captionLabel)}
        placeholder={t(($) => $.editor.figureDialog.captionPlaceholder)}
        onChange={(event) => onChange({ caption: event.target.value })}
      />
      <Input
        {...LITERAL_INPUT}
        className="font-mono"
        value={form.label}
        data-testid="figure-grid-label"
        aria-label={t(($) => $.editor.figureDialog.labelLabel)}
        placeholder={t(($) => $.editor.figureDialog.labelPlaceholder)}
        onChange={(event) => onChange({ label: event.target.value, labelTouched: true })}
      />
    </div>
  );
}

export function FigureGridTab({
  spec,
  onCancel,
  onSubmit,
}: Readonly<{ spec: FigureGridSpec | null; onCancel: () => void; onSubmit: (grid: FigureGridSource) => void }>) {
  const { t } = useTranslation(["common", "editor"]);
  const mainDoc = useFilesStore((state) => state.mainDoc);
  const [form, setForm] = useState<GridForm>(() => initialForm(spec));
  const hintId = useId();
  const patch = (changes: Partial<GridForm>) => setForm((current) => ({ ...current, ...changes }));
  const built = useMemo(() => gridSpec(form), [form]);
  const grid = useMemo(() => figureGridSource(built, (path) => latexGraphicsPath(path, mainDoc)), [built, mainDoc]);
  const zoom = built.zoom ?? null;
  const first = form.selected[0];

  const add = (paths: readonly string[]) =>
    setForm((current) => {
      const fresh = paths.filter((path) => !current.selected.includes(path));
      if (fresh.length === 0) return current;
      const suggest = !current.labelTouched && current.selected.length === 0;
      return {
        ...current,
        selected: [...current.selected, ...fresh],
        label: suggest ? suggestedFigureLabel(fresh[0]) : current.label,
      };
    });

  const toggle = (path: string) => {
    if (!form.selected.includes(path)) {
      add([path]);
      return;
    }
    setForm((current) => ({ ...current, selected: current.selected.filter((item) => item !== path) }));
  };

  const measured = (path: string, aspect: number) =>
    setForm((current) => (current.aspects[path] === aspect ? current : { ...current, aspects: { ...current.aspects, [path]: aspect } }));

  return (
    <>
      <div className="grid max-h-[65vh] gap-5 overflow-y-auto px-5 py-4 sm:grid-cols-[minmax(0,1fr)_15rem]">
        <section className="min-w-0 space-y-4">
          <ProjectImagePicker selected={form.selected} multiple testId="figure-grid" onChoose={toggle} onImported={add} />
          {form.selected.length > 0 ? (
            <div
              data-testid="figure-grid-preview"
              className="grid gap-1"
              style={{ gridTemplateColumns: `repeat(${gridColumns(form)}, minmax(0, 1fr))` }}
            >
              {form.selected.map((path) => (
                <GridCell key={path} path={path} aspect={form.aspects[path] ?? 1} zoom={zoom} onAspect={measured} />
              ))}
            </div>
          ) : null}
          {zoom && first ? (
            <ZoomArea path={first} rect={form.rect} color={form.color} hintId={hintId} onChange={(rect) => patch({ rect })} />
          ) : null}
          {form.selected.length > 0 ? (
            <div>
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t(($) => $.editor.figureDialog.gridSource)}
              </h3>
              <CodeBlock code={grid.source} preClassName="max-h-40" data-testid="figure-grid-source" />
            </div>
          ) : null}
        </section>
        <GridOptions form={form} rows={built.images.length} hintId={hintId} onChange={patch} />
      </div>
      <DialogFooter className="border-t px-5 py-3">
        <div className="flex items-center gap-2">
          {form.selected.length === 0 && (
            <span className="text-xs text-muted-foreground">{t(($) => $.editor.figureDialog.gridSelectImages)}</span>
          )}
          <Button type="button" variant="outline" size="sm" onClick={onCancel}>
            {t(($) => $.editor.figureDialog.cancel)}
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={form.selected.length === 0}
            data-testid="figure-grid-insert"
            onClick={() => onSubmit(grid)}
          >
            {spec ? t(($) => $.editor.figureDialog.gridSave) : t(($) => $.editor.figureDialog.gridInsert)}
          </Button>
        </div>
      </DialogFooter>
    </>
  );
}
