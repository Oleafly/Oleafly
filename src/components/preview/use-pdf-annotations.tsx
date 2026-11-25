import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import type { PdfAnnotationLayer, PdfMark, PdfRegionSelectionInfo, PdfTextSelectionInfo } from "@oleafly/preview";
import type { PdfViewerHandle } from "@/components/pdf/PdfViewer";
import { gotoRect, pdfPageText } from "@/components/pdf/pdfController";
import type { PopoverAnchor } from "@/components/ui/popover";
import type { PlaceDeps } from "@/features/pdf-annotations/place";
import type { CompileSuccessCheckpoint } from "@/lib/compile-checkpoint";
import { logError } from "@/lib/log";
import { lazy } from "@/lib/preloadable";
import { i18n, loadNamespace } from "@/i18n";
import type {
  PdfAnnotation,
  PdfAnnotationBox,
  PdfAnnotationKind,
  PdfAnnotationQuote,
} from "@/lib/tauri";
import { usePdfAnnotationsStore } from "@/store/pdf-annotations";
import { useSettingsStore } from "@/store/settings";
import type { TextAnnotationKind } from "./PdfAnnotationComposer";

const reviewing = () => useSettingsStore.getState().pdfReview;

const PdfAnnotationComposer = lazy(
  () =>
    Promise.all([import("./PdfAnnotationComposer"), loadNamespace("annotations")]).then(([module]) => ({
      default: module.PdfAnnotationComposer,
    })),
  { warm: reviewing },
);
const PdfAnnotationsPanel = lazy(
  () =>
    Promise.all([import("./PdfAnnotationsPanel"), loadNamespace("annotations")]).then(([module]) => ({
      default: module.PdfAnnotationsPanel,
    })),
  { warm: reviewing },
);

interface Fractions {
  left: number;
  top: number;
  width: number;
  height: number;
}

type Draft =
  | { from: "text"; build: string; selection: PdfTextSelectionInfo; range: Range | null; kind: TextAnnotationKind | null }
  | { from: "region"; build: string; region: PdfRegionSelectionInfo; fractions: Fractions | null; kind: "region" };

export interface PdfAnnotationsToolbar {
  count: number;
  panelOpen: boolean;
  togglePanel: () => void;
  regionMode: boolean;
  toggleRegionMode: () => void;
  marksShown: boolean;
  toggleMarks: () => void;
}

interface Options {
  projectId: string;
  build: string | null;
  documentReady: boolean;
  checkpoint: CompileSuccessCheckpoint | null;
  syncAvailable: boolean;
  pdfRef: RefObject<PdfViewerHandle | null>;
  containerRef: RefObject<HTMLElement | null>;
}

const EMPTY_QUOTE: PdfAnnotationQuote = { text: "", before: "", after: "" };

function pageWrap(container: HTMLElement | null, page: number): HTMLElement | null {
  return container?.querySelector<HTMLElement>(`[data-page="${page}"]`) ?? null;
}

function currentRange(): Range | null {
  const selection = document.getSelection();
  return selection && selection.rangeCount > 0 ? selection.getRangeAt(0).cloneRange() : null;
}

function rectOf(box: { left: number; top: number; width: number; height: number }): DOMRect {
  return new DOMRect(box.left, box.top, box.width, box.height);
}

async function regionQuote(region: PdfRegionSelectionInfo): Promise<PdfAnnotationQuote> {
  try {
    const [{ quoteInBox }, runs] = await Promise.all([import("@oleafly/preview/pdfQuote"), pdfPageText(region.page)]);
    return runs ? quoteInBox(runs, region.rect) : EMPTY_QUOTE;
  } catch (error) {
    void logError("read the text in a PDF region", error);
    return EMPTY_QUOTE;
  }
}

async function textOf(path: string): Promise<string | null> {
  const { sourceText } = await import("@/features/synctex");
  return sourceText(path);
}

async function placeDeps(checkpoint: CompileSuccessCheckpoint | null): Promise<PlaceDeps> {
  const [{ compiledSourceText, typesetLinesOf }, { findQuoteBoxes }] = await Promise.all([
    import("@/features/synctex"),
    import("@oleafly/preview/pdfQuote"),
  ]);
  return {
    compiledText: (path) => compiledSourceText(path, checkpoint),
    linesOf: (path, startLine, endLine) => typesetLinesOf(path, startLine, endLine, checkpoint),
    runsOf: pdfPageText,
    findQuote: findQuoteBoxes,
  };
}

export interface PdfAnnotationsView {
  viewerProps: {
    annotationLayer?: PdfAnnotationLayer;
    markLabel?: (mark: PdfMark) => string;
    marks?: readonly PdfMark[];
    onMarkActivate?: (id: string) => void;
    onSelectText?: (selection: PdfTextSelectionInfo | null) => void;
    regionSelect?: boolean;
    onSelectRegion?: (region: PdfRegionSelectionInfo) => void;
  };
  toolbar: PdfAnnotationsToolbar | null;
}

const markLabel = (mark: PdfMark) => i18n.t(($) => $.annotations.markBadge, { label: mark.label });

export function usePdfAnnotations({
  projectId,
  build,
  documentReady,
  checkpoint,
  syncAvailable,
  pdfRef,
  containerRef,
}: Options): PdfAnnotationsView & { overlay: ReactNode } {
  const items = usePdfAnnotationsStore((state) => state.items);
  const loaded = usePdfAnnotationsStore((state) => state.loaded);
  const activeId = usePdfAnnotationsStore((state) => state.activeId);
  const [panelOpen, setPanelOpen] = useState(false);
  const [regionMode, setRegionMode] = useState(false);
  const [marksShown, setMarksShown] = useState(true);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [placingId, setPlacingId] = useState<string | null>(null);
  const [layer, setLayer] = useState<PdfAnnotationLayer | null>(null);
  const [stringsReady, setStringsReady] = useState(false);
  const attemptedRef = useRef<{ key: string; ids: Set<string> } | null>(null);
  const checkpointRef = useRef(checkpoint);
  checkpointRef.current = checkpoint;

  useEffect(() => {
    void usePdfAnnotationsStore.getState().load(projectId);
  }, [projectId]);

  useEffect(() => {
    if (stringsReady) return;
    let live = true;
    loadNamespace("annotations")
      .then(() => {
        if (live) setStringsReady(true);
      })
      .catch((error: unknown) => logError("load the PDF annotation strings", error));
    return () => {
      live = false;
    };
  }, [stringsReady]);

  useEffect(() => {
    if (layer) return;
    let live = true;
    import("@oleafly/preview/pdfMarks")
      .then((module) => {
        if (live) setLayer(module.pdfAnnotationLayer);
      })
      .catch((error: unknown) => logError("load the PDF annotation layer", error));
    return () => {
      live = false;
    };
  }, [layer]);

  useEffect(() => {
    void build;
    setDraft((current) => (current?.kind ? current : null));
  }, [build]);

  useEffect(() => {
    if (!loaded || !build || !documentReady) return;
    const key = `${projectId}:${build}`;
    if (attemptedRef.current?.key !== key) attemptedRef.current = { key, ids: new Set() };
    const tried = attemptedRef.current.ids;
    const stale = items.filter(
      (item) => (item.build !== build || item.placement === "needsPlacing") && !tried.has(item.id),
    );
    if (stale.length === 0) return;
    for (const item of stale) tried.add(item.id);
    const current = () => attemptedRef.current?.key === key;
    void (async () => {
      try {
        const [{ placeAnnotations }, deps] = await Promise.all([
          import("@/features/pdf-annotations/place"),
          placeDeps(checkpointRef.current),
        ]);
        if (!current()) return;
        const updates = await placeAnnotations(stale, build, deps);
        if (current()) await usePdfAnnotationsStore.getState().update(updates, { quiet: true });
      } catch (error) {
        void logError("place PDF annotations again", error);
      }
    })();
  }, [loaded, build, documentReady, projectId, items]);

  const marks = useMemo<readonly PdfMark[]>(
    () =>
      marksShown
        ? items
            .filter((item) => item.build === build && item.boxes.length > 0 && item.placement !== "needsPlacing")
            .map((item) => ({ id: item.id, label: String(item.number), rects: item.boxes, active: item.id === activeId }))
        : [],
    [marksShown, items, build, activeId],
  );

  const onSelectText = useCallback(
    (selection: PdfTextSelectionInfo | null) => {
      setDraft((current) => {
        if (current?.kind) return current;
        return selection && build ? { from: "text", build, selection, range: currentRange(), kind: null } : null;
      });
    },
    [build],
  );

  const onSelectRegion = useCallback(
    (region: PdfRegionSelectionInfo) => {
      const wrap = pageWrap(containerRef.current, region.page)?.getBoundingClientRect();
      const fractions =
        wrap && wrap.width > 0 && wrap.height > 0
          ? {
              left: (region.clientRect.left - wrap.left) / wrap.width,
              top: (region.clientRect.top - wrap.top) / wrap.height,
              width: region.clientRect.width / wrap.width,
              height: region.clientRect.height / wrap.height,
            }
          : null;
      if (build) setDraft({ from: "region", build, region, fractions, kind: "region" });
    },
    [containerRef, build],
  );

  const onMarkActivate = useCallback((id: string) => {
    usePdfAnnotationsStore.getState().setActive(id);
    setPanelOpen(true);
  }, []);

  const finishDraft = (current: Draft) => {
    if (current.from === "text") document.getSelection()?.removeAllRanges();
    else setRegionMode(false);
    setDraft(null);
  };

  const save = async (current: Draft, kind: PdfAnnotationKind, comment: string): Promise<boolean> => {
    const { build: madeOn } = current;
    const store = usePdfAnnotationsStore.getState();
    const text = current.from === "text";
    const quote: PdfAnnotationQuote = text
      ? { text: current.selection.text, before: current.selection.before, after: current.selection.after }
      : await regionQuote(current.region);
    const page = text ? current.selection.page : current.region.page;
    const boxes: PdfAnnotationBox[] = text ? current.selection.rects : [current.region.rect];
    let id: string | null = null;
    if (placingId) {
      const done = await store.update([
        { id: placingId, quote, page, boxes, build: madeOn, placement: "placed", source: null },
      ]);
      if (!done) return false;
      id = placingId;
      setPlacingId(null);
    } else {
      const added = await store.add({ kind, comment, quote, page, source: null, boxes, build: madeOn, origin: "pdf" });
      if (!added) return false;
      id = added.id;
    }
    finishDraft(current);
    setMarksShown(true);
    if (madeOn !== build) return true;
    try {
      const [{ chooseSource, locateSource, regionProbePoints }, { sourceTexts }] = await Promise.all([
        import("@/features/pdf-annotations/locate"),
        import("@/features/synctex"),
      ]);
      const [start, end] = text
        ? [current.selection.start, current.selection.end]
        : regionProbePoints(current.region.rect);
      const synced = syncAvailable ? await locateSource(start, end, checkpointRef.current, undefined, textOf) : null;
      const source = chooseSource(quote, synced, !text, sourceTexts);
      if (source) await usePdfAnnotationsStore.getState().update([{ id, source }], { quiet: true });
    } catch (error) {
      void logError("find the source of a PDF annotation", error);
    }
    return true;
  };

  const saveOrThrow = async (current: Draft, kind: PdfAnnotationKind, comment: string) => {
    if (await save(current, kind, comment)) return;
    throw new Error(usePdfAnnotationsStore.getState().error ?? "");
  };

  const show = (annotation: PdfAnnotation) => {
    setMarksShown(true);
    usePdfAnnotationsStore.getState().setActive(annotation.id);
    const rect = annotation.build === build ? annotation.boxes[0] : undefined;
    if (rect) gotoRect(rect);
    else pdfRef.current?.gotoPage(annotation.page);
  };

  const viewerProps = useMemo(
    () => ({
      annotationLayer: layer ?? undefined,
      markLabel,
      marks,
      onMarkActivate,
      onSelectText,
      regionSelect: regionMode,
      onSelectRegion,
    }),
    [layer, marks, onMarkActivate, onSelectText, regionMode, onSelectRegion],
  );

  const count = items.length;
  const toolbar = useMemo<PdfAnnotationsToolbar | null>(
    () =>
      stringsReady
        ? {
            count,
            panelOpen,
            togglePanel: () => setPanelOpen((open) => !open),
            regionMode,
            toggleRegionMode: () => {
              setDraft(null);
              setRegionMode((on) => !on);
            },
            marksShown,
            toggleMarks: () => setMarksShown((shown) => !shown),
          }
        : null,
    [stringsReady, count, panelOpen, regionMode, marksShown],
  );

  let anchor: PopoverAnchor | null = null;
  let contextElement: Element | null = null;
  if (draft?.from === "text") {
    const { range, selection } = draft;
    anchor = () => {
      const live = typeof range?.getBoundingClientRect === "function" ? range.getBoundingClientRect() : null;
      return live && (live.width > 0 || live.height > 0) ? live : rectOf(selection.clientRect);
    };
    contextElement = range?.startContainer.parentElement ?? null;
  } else if (draft?.from === "region") {
    const { region, fractions } = draft;
    contextElement = pageWrap(containerRef.current, region.page);
    anchor = () => {
      const wrap = pageWrap(containerRef.current, region.page)?.getBoundingClientRect();
      if (!wrap || !fractions) return rectOf(region.clientRect);
      return new DOMRect(
        wrap.left + fractions.left * wrap.width,
        wrap.top + fractions.top * wrap.height,
        fractions.width * wrap.width,
        fractions.height * wrap.height,
      );
    };
  }

  const cancel = () => {
    if (draft?.from === "region") setRegionMode(false);
    setDraft(null);
  };

  return {
    viewerProps,
    toolbar,
    overlay: (
      <>
        {draft && anchor ? (
          <Suspense fallback={null}>
            <PdfAnnotationComposer
              key={draft.from === "text" ? `${draft.selection.page}:${draft.selection.text}` : "region"}
              anchor={anchor}
              contextElement={contextElement}
              kind={placingId || draft.kind === "delete" ? null : draft.kind}
              placing={placingId !== null}
              onPick={(kind) => {
                if (kind === "delete") {
                  void save(draft, kind, "");
                  return;
                }
                setDraft((current) => (current?.from === "text" ? { ...current, kind } : current));
              }}
              onSave={(comment) => saveOrThrow(draft, draft.kind ?? "comment", comment)}
              onPlace={() => void save(draft, draft.kind ?? "comment", "")}
              onCancel={cancel}
            />
          </Suspense>
        ) : null}
        <Suspense fallback={null}>
          <PdfAnnotationsPanel
            id="pdf-annotations-panel"
            open={panelOpen}
            placingId={placingId}
            onClose={() => {
              setPanelOpen(false);
              setPlacingId(null);
            }}
            onShow={show}
            onPlaceAgain={(annotation) => setPlacingId(annotation?.id ?? null)}
          />
        </Suspense>
      </>
    ),
  };
}

export function PdfAnnotationsHost({
  slot,
  onView,
  ...options
}: Options & { slot: HTMLElement | null; onView: (view: PdfAnnotationsView | null) => void }) {
  const { viewerProps, toolbar, overlay } = usePdfAnnotations(options);
  useLayoutEffect(() => onView({ viewerProps, toolbar }), [onView, viewerProps, toolbar]);
  useLayoutEffect(() => () => onView(null), [onView]);
  return slot ? createPortal(overlay, slot) : null;
}
