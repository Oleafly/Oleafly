import { Fragment, useState, type Dispatch, type RefObject, type SetStateAction } from "react";
import { useTranslation } from "react-i18next";
import {
  Accessibility, ChevronDown, ChevronUp, Columns2, Contrast, Download,
  FileText, ListTree, Loader2, Maximize, Minimize, MoreHorizontal,
  PanelTopClose, RectangleVertical, RotateCw, Save, Search, Settings2,
  SquareArrowOutUpRight, ZoomIn, ZoomOut,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip } from "@/components/ui/tooltip";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem,
  DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuPortal,
  DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent,
  DropdownMenuSubTrigger, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DIVIDER_WIDTH, ICON_BUTTON_WIDTH, fitCount, useAvailableWidth, type ToolbarControl } from "@/components/ui/toolbar-overflow";
import type { PdfLayout, PdfRotation, PdfViewerHandle } from "@/components/pdf/PdfViewer";
import { i18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { MAX_PREVIEW_SCALE, MIN_PREVIEW_SCALE } from "./preview-zoom";

type Setter<T> = Dispatch<SetStateAction<T>>;
export interface PdfToolbarControlsProps {
  isImage: boolean;
  hasDocument: boolean;
  numPages: number;
  page: number;
  pageInput: string;
  setPageInput: Setter<string>;
  jumpToPage: () => void;
  pdfRef: RefObject<PdfViewerHandle | null>;
  layout: PdfLayout;
  setLayout: Setter<PdfLayout>;
  outlineOpen: boolean;
  setOutlineOpen: Setter<boolean>;
  searchOpen: boolean;
  setSearchOpen: Setter<boolean>;
  searchInputRef: RefObject<HTMLInputElement | null>;
  setSearchInput: Setter<string>;
  scale: number;
  setScale: Setter<number>;
  setClampedScale: (scale: number) => void;
  userZoom: (mutate: () => void) => void;
  fitPreview: (mode: "width" | "height") => void;
  exporting: boolean;
  exportDisplayedPreview: () => void;
  downloadActionLabel: () => string;
  onSave: () => void;
  inverted: boolean;
  setInverted: (value: boolean) => void;
  screenReaderMode: boolean;
  setScreenReaderMode: Setter<boolean>;
  rotation: PdfRotation;
  rotationPending: boolean;
  onRotate: () => void;
  isFs: boolean;
  setFsToolbarHidden: Setter<boolean>;
  toggleFullscreen: () => void;
  detached?: boolean;
  onWindow: () => void;
  onSettings: () => void;
}

const ZOOM_PRESETS = [0.25, 0.5, 0.75, 1, 1.5, 2, 4];

const PAGE_LAYOUTS: readonly {
  value: PdfLayout;
  label: () => string;
  icon: typeof RectangleVertical;
}[] = [
  {
    value: "single",
    label: () => i18n.t(($) => $.preview.pageLayout.single),
    icon: RectangleVertical,
  },
  {
    value: "double",
    label: () => i18n.t(($) => $.preview.pageLayout.double),
    icon: Columns2,
  },
];

export function PdfToolbarControls({
  isImage, hasDocument, numPages, page, pageInput, setPageInput, jumpToPage, pdfRef, layout, setLayout, outlineOpen, setOutlineOpen, searchOpen, setSearchOpen, searchInputRef, setSearchInput, scale, setScale, setClampedScale, userZoom, fitPreview, exporting, exportDisplayedPreview, downloadActionLabel, onSave, inverted, setInverted, screenReaderMode, setScreenReaderMode, rotation, rotationPending, onRotate, isFs, setFsToolbarHidden, toggleFullscreen, detached = false, onWindow, onSettings
}: Readonly<PdfToolbarControlsProps>) {
  const { t } = useTranslation(["preview", "ai"]);
  const [zoomMenuOpen, setZoomMenuOpen] = useState(false);
  const { containerRef: pdfToolbarRef, availableWidth: pdfToolbarWidth } =
    useAvailableWidth();
  // The preview toolbar carries more controls than a narrow split pane can
  // show. Declaring them as a measured list lets the ones that do not fit move
  // into a "more" menu instead of wrapping the bar onto a second line.
  const iconControl = (
    id: string,
    Icon: typeof ZoomIn,
    label: string,
    onClick: () => void,
    options: {
      disabled?: boolean;
      active?: boolean;
      tooltip?: string;
      // Swaps the icon for a spinner in place. Work a single control owns
      // belongs on that control, not behind a pane-sized overlay.
      busy?: boolean;
    } = {},
  ): ToolbarControl => ({
    id,
    width: ICON_BUTTON_WIDTH,
    render: () => (
      <Tooltip label={options.tooltip ?? label}>
        <Button
          variant="ghost"
          size="icon"
          className={cn("size-7", options.active && "bg-accent text-foreground")}
          disabled={options.disabled || options.busy}
          onClick={onClick}
          aria-label={label}
          {...(options.busy ? { "aria-busy": true } : {})}
          {...(options.active === undefined ? {} : { "aria-pressed": options.active })}
        >
          {options.busy ? (
            <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" />
          ) : (
            <Icon className="size-3.5" />
          )}
        </Button>
      </Tooltip>
    ),
    renderMenu: () => (
      <DropdownMenuItem
        key={id}
        aria-label={label}
        disabled={options.disabled}
        onSelect={onClick}
      >
        <Icon className="size-4" />
        {label}
      </DropdownMenuItem>
    ),
  });

  const pdfDivider = (id: string): ToolbarControl => ({
    id,
    width: DIVIDER_WIDTH,
    render: () => <div className="mx-1 h-4 w-px shrink-0 bg-border" />,
    renderMenu: () => <DropdownMenuSeparator key={id} />,
  });

  const zoomOut = () =>
    userZoom(() => setScale((s) => Math.max(MIN_PREVIEW_SCALE, s - 0.2)));
  const zoomIn = () =>
    userZoom(() => setScale((s) => Math.min(MAX_PREVIEW_SCALE, s + 0.2)));
  // Rendered by the zoom trigger and, when the bar collapses, by the overflow menu.
  const zoomMenuItems = () => (
    <>
      <DropdownMenuGroup>
        <DropdownMenuItem disabled={scale >= MAX_PREVIEW_SCALE} onSelect={zoomIn}>
          {t(($) => $.preview.zoom.in)}
        </DropdownMenuItem>
        <DropdownMenuItem disabled={scale <= MIN_PREVIEW_SCALE} onSelect={zoomOut}>
          {t(($) => $.preview.zoom.out)}
        </DropdownMenuItem>
      </DropdownMenuGroup>
      <DropdownMenuSeparator />
      <DropdownMenuGroup>
        <DropdownMenuItem onSelect={() => userZoom(() => fitPreview("width"))}>
          {t(($) => $.preview.zoom.fitToWidth)}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => userZoom(() => fitPreview("height"))}>
          {t(($) => $.preview.zoom.fitToHeight)}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => userZoom(() => setScale(1))}>
          {t(($) => $.preview.zoom.reset)}
        </DropdownMenuItem>
      </DropdownMenuGroup>
      <DropdownMenuSeparator />
      <DropdownMenuGroup>
        {ZOOM_PRESETS.map((preset) => (
          <DropdownMenuItem
            key={preset}
            onSelect={() => userZoom(() => setClampedScale(preset))}
          >
            {t(($) => $.preview.zoom.percent, { percent: Math.round(preset * 100) })}
          </DropdownMenuItem>
        ))}
      </DropdownMenuGroup>
    </>
  );

  // Grouped so the bar reads in a fixed order and the dividers fall out of
  // which groups actually have controls, rather than being placed by hand.
  const buildPreviewToolbarGroups = () => {
    const layoutGroup: ToolbarControl[] = [];
    const pageGroup: ToolbarControl[] = [];
    const viewGroup: ToolbarControl[] = [];
    const zoomGroup: ToolbarControl[] = [];
    const inkGroup: ToolbarControl[] = [];
    const fileGroup: ToolbarControl[] = [];
    const windowGroup: ToolbarControl[] = [];
    if (numPages > 0 && !isImage) {
      // A one-page document has nothing to lay out: hide the toggles entirely.
      if (numPages > 1) {
        layoutGroup.push(
          {
            id: "layout",
            // Two segments inside one padded track.
            width: 62,
            // One page layout is in effect at a time, so the two options are a
            // radio group rather than two independently pressed buttons.
            render: () => (
              <div
                role="radiogroup"
                aria-label={t(($) => $.preview.pageLayout.group)}
                className="flex shrink-0 items-center gap-0.5 rounded-md bg-muted/70 p-0.5"
              >
                {PAGE_LAYOUTS.map(({ value, label, icon: Icon }) => (
                  <Tooltip key={value} label={label()}>
                    <Button
                      variant="ghost"
                      size="icon"
                      role="radio"
                      className={cn(
                        "size-6 rounded-[4px]",
                        layout === value &&
                          "bg-background text-foreground shadow-[0_1px_2px_oklch(0_0_0/0.08)]",
                      )}
                      onClick={() => setLayout(value)}
                      aria-label={label()}
                      aria-checked={layout === value}
                    >
                      <Icon className="size-3.5" />
                    </Button>
                  </Tooltip>
                ))}
              </div>
            ),
            renderMenu: () => (
              <DropdownMenuSub key="layout">
                <DropdownMenuSubTrigger>
                  <RectangleVertical className="size-4" />
                  {t(($) => $.preview.pageLayout.group)}
                </DropdownMenuSubTrigger>
                <DropdownMenuPortal>
                  <DropdownMenuSubContent className="min-w-44">
                    <DropdownMenuRadioGroup
                      value={layout}
                      onValueChange={(value) =>
                        setLayout(value === "double" ? "double" : "single")
                      }
                    >
                      {PAGE_LAYOUTS.map(({ value, label, icon: Icon }) => (
                        <DropdownMenuRadioItem key={value} value={value}>
                          <Icon className="size-4" />
                          {label()}
                        </DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                  </DropdownMenuSubContent>
                </DropdownMenuPortal>
              </DropdownMenuSub>
            ),
          },
        );
      }
      pageGroup.push(
        {
          id: "page-nav",
          // Two buttons plus the page field and its "of N" label. Estimates are
          // rounded up: overshooting collapses one control early, undershooting
          // clips the bar.
          width: 140,
          render: () => (
            <>
              <Tooltip label={t(($) => $.preview.pages.previous)}>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  disabled={page <= 1}
                  onClick={() => pdfRef.current?.gotoPage(page - (layout === "double" ? 2 : 1))}
                  aria-label={t(($) => $.preview.pages.previous)}
                >
                  <ChevronUp className="size-3.5" />
                </Button>
              </Tooltip>
              <div className="flex shrink-0 items-center gap-1 text-xs tabular-nums text-muted-foreground">
                <Input
                  value={pageInput}
                  onChange={(e) => setPageInput(e.target.value.replace(/\D/g, ""))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      jumpToPage();
                      (e.target as HTMLInputElement).blur();
                    }
                  }}
                  onBlur={jumpToPage}
                  onFocus={(e) => e.target.select()}
                  aria-label={t(($) => $.preview.pages.number)}
                  className="h-6 w-7 rounded border border-input bg-background px-0.5 py-0 text-center text-[11px] leading-none text-foreground outline-none focus:border-primary"
                />
                <span>{t(($) => $.preview.pages.ofTotal, { total: numPages })}</span>
              </div>
              <Tooltip label={t(($) => $.preview.pages.next)}>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  disabled={page >= numPages}
                  onClick={() => pdfRef.current?.gotoPage(page + (layout === "double" ? 2 : 1))}
                  aria-label={t(($) => $.preview.pages.next)}
                >
                  <ChevronDown className="size-3.5" />
                </Button>
              </Tooltip>
            </>
          ),
          // The page field cannot live in a menu row, so the collapsed form keeps
          // the navigation and reports where the reader currently is.
          renderMenu: () => (
            <DropdownMenuSub key="page-nav">
              <DropdownMenuSubTrigger>
                <FileText className="size-4" />
                {t(($) => $.preview.pages.pageOfTotal, {
                  page,
                  total: numPages,
                })}
              </DropdownMenuSubTrigger>
              <DropdownMenuPortal>
                <DropdownMenuSubContent className="min-w-44">
                  <DropdownMenuItem
                    disabled={page <= 1}
                    onSelect={() => pdfRef.current?.gotoPage(page - (layout === "double" ? 2 : 1))}
                  >
                    <ChevronUp className="size-4" />
                    {t(($) => $.preview.pages.previous)}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={page >= numPages}
                    onSelect={() => pdfRef.current?.gotoPage(page + (layout === "double" ? 2 : 1))}
                  >
                    <ChevronDown className="size-4" />
                    {t(($) => $.preview.pages.next)}
                  </DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuPortal>
            </DropdownMenuSub>
          ),
        },
      );
    }
    if (hasDocument && !isImage) {
      viewGroup.push(
        iconControl(
          "outline",
          ListTree,
          t(($) => $.preview.outline.open),
          () => setOutlineOpen((open) => !open),
          { active: outlineOpen },
        ),
        iconControl("search", Search, t(($) => $.preview.search.open), () => {
          setSearchOpen((open) => {
            const next = !open;
            if (next) {
              requestAnimationFrame(() =>
                searchInputRef.current?.focus({ preventScroll: true }),
              );
            } else {
              setSearchInput("");
            }
            return next;
          });
        }, { active: searchOpen }),
      );
    }
    zoomGroup.push({
      id: "zoom",
      // Zoom out, the percentage trigger, and zoom in.
      width: 128,
      render: () => (
        <>
          <Tooltip label={t(($) => $.preview.zoom.out)}>
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              disabled={scale <= MIN_PREVIEW_SCALE}
              onClick={zoomOut}
              aria-label={t(($) => $.preview.zoom.out)}
            >
              <ZoomOut className="size-3.5" />
            </Button>
          </Tooltip>
          <DropdownMenu open={zoomMenuOpen} onOpenChange={setZoomMenuOpen}>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 min-w-14 gap-1 px-1.5 text-xs tabular-nums text-muted-foreground"
                data-testid={detached ? "detached-preview-zoom" : undefined}
                aria-label={t(($) => $.preview.zoom.percentLabel, {
                  percent: Math.round(scale * 100),
                })}
                disabled={!hasDocument}
              >
                {t(($) => $.preview.zoom.percent, { percent: Math.round(scale * 100) })}
                <ChevronDown data-icon="inline-end" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="center" className="min-w-40">
              {zoomMenuItems()}
            </DropdownMenuContent>
          </DropdownMenu>
          <Tooltip label={t(($) => $.preview.zoom.in)}>
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              disabled={scale >= MAX_PREVIEW_SCALE}
              onClick={zoomIn}
              aria-label={t(($) => $.preview.zoom.in)}
            >
              <ZoomIn className="size-3.5" />
            </Button>
          </Tooltip>
        </>
      ),
      renderMenu: () => (
        <DropdownMenuSub key="zoom">
          <DropdownMenuSubTrigger>
            <ZoomIn className="size-4" />
            {t(($) => $.preview.zoom.menuLabel, {
              percent: Math.round(scale * 100),
            })}
          </DropdownMenuSubTrigger>
          <DropdownMenuPortal>
            <DropdownMenuSubContent className="min-w-40">
              {zoomMenuItems()}
            </DropdownMenuSubContent>
          </DropdownMenuPortal>
        </DropdownMenuSub>
      ),
    });
    fileGroup.push(
      {
        id: "download",
        width: ICON_BUTTON_WIDTH,
        render: () => (
          <Tooltip
            label={
              isImage
                ? t(($) => $.preview.actions.downloadImage)
                : t(($) => $.preview.actions.downloadDisplayedPdf)
            }
          >
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              disabled={!hasDocument || exporting}
              onClick={() => void exportDisplayedPreview()}
              aria-label={downloadActionLabel()}
            >
              {exporting ? (
                <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" />
              ) : (
                <Download className="size-3.5" />
              )}
            </Button>
          </Tooltip>
        ),
        renderMenu: () => (
          <DropdownMenuItem
            key="download"
            disabled={!hasDocument || exporting}
            onSelect={() => void exportDisplayedPreview()}
          >
            <Download className="size-4" />
            {isImage
              ? t(($) => $.preview.actions.downloadImage)
              : t(($) => $.preview.actions.downloadPdf)}
          </DropdownMenuItem>
        ),
      },
      iconControl(
        "save",
        Save,
        isImage
          ? t(($) => $.preview.actions.saveImage)
          : t(($) => $.preview.actions.savePdf),
        onSave,
        { disabled: !hasDocument },
      ),
    );
    inkGroup.push(
      iconControl(
        "invert",
        Contrast,
        t(($) => $.preview.actions.invert),
        () => setInverted(!inverted),
        {
          disabled: !hasDocument,
          active: inverted,
          tooltip: inverted
            ? t(($) => $.preview.actions.restoreColors)
            : t(($) => $.preview.actions.invert),
        },
      ),
      iconControl(
        "screen-reader",
        Accessibility,
        t(($) => $.preview.actions.readerView),
        () => setScreenReaderMode(!screenReaderMode),
        {
          disabled: !hasDocument || isImage,
          active: screenReaderMode,
          tooltip: screenReaderMode
            ? t(($) => $.preview.actions.exitReaderView)
            : t(($) => $.preview.actions.readerView),
        },
      ),
    );
    if (!isImage) {
      inkGroup.push(
        iconControl(
          "rotate",
          RotateCw,
          t(($) => $.preview.actions.rotate),
          onRotate,
          {
            disabled: !hasDocument,
            busy: rotationPending,
            tooltip: t(($) => $.preview.actions.rotateTooltip, {
              degrees: rotation,
            }),
          },
        ),
      );
    }
    const pushPreviewWindowControls = () => {
      if (!isFs) {
        windowGroup.push(
          iconControl(
            "open-window",
            detached ? PanelTopClose : SquareArrowOutUpRight,
            detached ? t(($) => $.ai.shell.dockBack) : t(($) => $.preview.actions.openWindow),
            onWindow,
            { disabled: !hasDocument },
          ),
        );
      } else {
        windowGroup.push(
          iconControl(
            "hide-toolbar",
            PanelTopClose,
            t(($) => $.preview.actions.hideToolbar),
            () =>
              setFsToolbarHidden(true),
          ),
        );
      }
      windowGroup.push(
        iconControl(
          "pdf-settings",
          Settings2,
          t(($) => $.preview.actions.settings),
          onSettings,
        ),
      );
    };
    pushPreviewWindowControls();
    viewGroup.push(
      iconControl(
        "fullscreen",
        isFs ? Minimize : Maximize,
        isFs
          ? t(($) => $.preview.actions.exitFullscreen)
          : t(($) => $.preview.actions.fullscreen),
        toggleFullscreen,
        { disabled: !hasDocument },
      ),
    );
    return { layoutGroup, pageGroup, viewGroup, zoomGroup, inkGroup, fileGroup, windowGroup };
  };
  const { layoutGroup, pageGroup, viewGroup, zoomGroup, inkGroup, fileGroup, windowGroup } = buildPreviewToolbarGroups();

  const pdfControls: ToolbarControl[] = [
    viewGroup,
    zoomGroup,
    pageGroup,
    layoutGroup,
    inkGroup,
    fileGroup,
    windowGroup,
  ]
    .filter((group) => group.length > 0)
    .flatMap((group, index) =>
      index === 0 ? group : [pdfDivider(`divider-${index}`), ...group],
    );

  const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  const pdfVisibleCount = fitCount(pdfControls, pdfToolbarWidth * 16 / rem);
  const pdfVisibleControls = pdfControls.slice(0, pdfVisibleCount);
  const pdfOverflowControls = pdfControls.slice(pdfVisibleCount);

  return (
        <div
          data-tour="project-preview-zoom"
          ref={pdfToolbarRef}
          className="ml-auto flex min-w-7 flex-1 items-center justify-end gap-0.5 overflow-hidden"
        >
          {pdfVisibleControls.map((control) => (
            <Fragment key={control.id}>{control.render()}</Fragment>
          ))}
          {pdfOverflowControls.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  aria-label={t(($) => $.preview.toolbar.more)}
                >
                  <MoreHorizontal className="size-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-48">
                {pdfOverflowControls.map((control) => control.renderMenu())}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
  );
}
