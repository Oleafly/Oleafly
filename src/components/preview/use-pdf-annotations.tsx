import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import type { PdfMark, PdfRegionSelectionInfo, PdfTextSelectionInfo } from "@oleafly/preview";
import type { PdfViewerHandle } from "@/components/pdf/PdfViewer";
import { gotoRect, pdfPageText } from "@/components/pdf/pdfController";
import type { PopoverAnchor } from "@/components/ui/popover";
import { ensureAiProviderOrOpenSettings, handoffToAssistant } from "@/features/assistant-handoff";
import { annotationContextItems } from "@/features/pdf-annotations/context";
import type { PlaceDeps } from "@/features/pdf-annotations/place";
import type { CompileSuccessCheckpoint } from "@/lib/compile-checkpoint";
import { logError } from "@/lib/log";
import type { PdfAnnotation, PdfAnnotationBox, PdfAnnotationKind, PdfAnnotationQuote } from "@/lib/tauri";
import { usePdfAnnotationsStore } from "@/store/pdf-annotations";
import type { TextAnnotationKind } from "./PdfAnnotationComposer";

const PdfAnnotationComposer = lazy(() =>
  import("./PdfAnnotationComposer").then((module) => ({ default: module.PdfAnnotationComposer })),
);
const PdfAnnotationsPanel = lazy(() =>
  import("./PdfAnnotationsPanel").then((module) => ({ default: module.PdfAnnotationsPanel })),
);

interface Fractions {
  left: number;
  top: number;
  width: number;
  height: number;
}

type Draft =
  | { from: "text"; selection: PdfTextSelectionInfo; range: Range | null; kind: TextAnnotationKind | null }
  | { from: "region"; region: PdfRegionSelectionInfo; fractions: Fractions | null; kind: "region" };

export interface PdfAnnotationsToolbar {
  count: number;
  panelOpen: boolean;
  togglePanel: () => void;
  regionMode: boolean;
  toggleRegionMode: () => void;
}

interface Options {
  enabled: boolean;
  projectId: string | null;
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

async function textOf(path: string): Promise<string | null> {
  const { sourceText } = await import("@/features/synctex");
  return sourceText(path);
}

async function placeDeps(checkpoint: CompileSuccessCheckpoint | null): Promise<PlaceDeps> {
  const [{ sourceText, typesetLinesOf }, { findQuoteBoxes }] = await Promise.all([
    import("@/features/synctex"),
    import("@oleafly/preview"),
  ]);
  return {
    textOf: sourceText,
    linesOf: (path, startLine, endLine) => typesetLinesOf(path, startLine, endLine, checkpoint),
    runsOf: pdfPageText,
    findQuote: findQuoteBoxes,
  };
}

export function usePdfAnnotations({
  enabled,
  projectId,
  build,
  documentReady,
  checkpoint,
  syncAvailable,
  pdfRef,
  containerRef,
}: Options): {
  viewerProps: {
    marks?: readonly PdfMark[];
    onMarkActivate?: (id: string) => void;
    onSelectText?: (selection: PdfTextSelectionInfo | null) => void;
    regionSelect?: boolean;
    onSelectRegion?: (region: PdfRegionSelectionInfo) => void;
  };
  toolbar: PdfAnnotationsToolbar | null;
  overlay: ReactNode;
} {
  const items = usePdfAnnotationsStore((state) => state.items);
  const loaded = usePdfAnnotationsStore((state) => state.loaded);
  const activeId = usePdfAnnotationsStore((state) => state.activeId);
  const [panelOpen, setPanelOpen] = useState(false);
  const [regionMode, setRegionMode] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [placingId, setPlacingId] = useState<string | null>(null);
  const placedRef = useRef<string | null>(null);
  const checkpointRef = useRef(checkpoint);
  checkpointRef.current = checkpoint;

  useEffect(() => {
    void usePdfAnnotationsStore.getState().load(enabled ? projectId : null);
  }, [enabled, projectId]);

  useEffect(() => {
    if (enabled) return;
    setPanelOpen(false);
    setRegionMode(false);
    setDraft(null);
    setPlacingId(null);
  }, [enabled]);

  useEffect(() => {
    void build;
    setDraft(null);
  }, [build]);

  useEffect(() => {
    if (!enabled || !loaded || !build || !documentReady || !syncAvailable) return;
    const key = `${projectId}:${build}`;
    if (placedRef.current === key) return;
    placedRef.current = key;
    const stale = usePdfAnnotationsStore
      .getState()
      .items.filter((item) => item.build !== build || item.status === "needsPlacing");
    if (stale.length === 0) return;
    let cancelled = false;
    void (async () => {
      try {
        const [{ placeAnnotations }, deps] = await Promise.all([
          import("@/features/pdf-annotations/place"),
          placeDeps(checkpointRef.current),
        ]);
        if (cancelled) return;
        const updates = await placeAnnotations(stale, build, deps);
        if (!cancelled && placedRef.current === key) await usePdfAnnotationsStore.getState().update(updates);
      } catch (error) {
        void logError("place PDF annotations again", error);
      }
    })();
    return () => {
      cancelled = true;
      if (placedRef.current === key) placedRef.current = null;
    };
  }, [enabled, loaded, build, documentReady, syncAvailable, projectId]);

  const marks = useMemo<readonly PdfMark[]>(
    () =>
      items
        .filter((item) => item.build === build && item.boxes.length > 0 && item.status !== "needsPlacing")
        .map((item) => ({ id: item.id, label: String(item.number), rects: item.boxes, active: item.id === activeId })),
    [items, build, activeId],
  );

  const onSelectText = useCallback((selection: PdfTextSelectionInfo | null) => {
    setDraft((current) => {
      if (current?.kind) return current;
      return selection ? { from: "text", selection, range: currentRange(), kind: null } : null;
    });
  }, []);

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
      setDraft({ from: "region", region, fractions, kind: "region" });
    },
    [containerRef],
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

  const save = async (current: Draft, kind: PdfAnnotationKind, comment: string) => {
    if (!build) return;
    const store = usePdfAnnotationsStore.getState();
    const text = current.from === "text";
    const quote: PdfAnnotationQuote = text
      ? { text: current.selection.text, before: current.selection.before, after: current.selection.after }
      : EMPTY_QUOTE;
    const page = text ? current.selection.page : current.region.page;
    const boxes: PdfAnnotationBox[] = text ? current.selection.rects : [current.region.rect];
    let id: string | null = null;
    if (placingId) {
      const done = await store.update([{ id: placingId, quote, page, boxes, build, status: "draft" }]);
      if (!done) return;
      id = placingId;
      setPlacingId(null);
    } else {
      const added = await store.add({ kind, comment, quote, page, source: null, boxes, build, origin: "pdf" });
      if (!added) return;
      id = added.id;
    }
    finishDraft(current);
    if (!syncAvailable) return;
    try {
      const { locateSource, regionProbePoints } = await import("@/features/pdf-annotations/locate");
      const [start, end] = text
        ? [current.selection.start, current.selection.end]
        : regionProbePoints(current.region.rect);
      const source = await locateSource(start, end, checkpointRef.current, undefined, textOf);
      if (source) await usePdfAnnotationsStore.getState().update([{ id, source }]);
    } catch (error) {
      void logError("find the source of a PDF annotation", error);
    }
  };

  const show = (annotation: PdfAnnotation) => {
    usePdfAnnotationsStore.getState().setActive(annotation.id);
    const rect = annotation.build === build ? annotation.boxes[0] : undefined;
    if (rect) gotoRect(rect);
    else pdfRef.current?.gotoPage(annotation.page);
  };

  const send = async (annotations: PdfAnnotation[]) => {
    if (annotations.length === 0) return;
    if (!(await ensureAiProviderOrOpenSettings())) return;
    handoffToAssistant("", { autoSend: false, context: annotationContextItems(annotations) });
  };

  if (!enabled || !projectId) return { viewerProps: {}, toolbar: null, overlay: null };

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
    viewerProps: {
      marks,
      onMarkActivate,
      onSelectText,
      regionSelect: regionMode,
      onSelectRegion,
    },
    toolbar: {
      count: items.length,
      panelOpen,
      togglePanel: () => setPanelOpen((open) => !open),
      regionMode,
      toggleRegionMode: () => {
        setDraft(null);
        setRegionMode((on) => !on);
      },
    },
    overlay: (
      <>
        {draft && anchor ? (
          <Suspense fallback={null}>
            <PdfAnnotationComposer
              key={draft.from === "text" ? `${draft.selection.page}:${draft.selection.text}` : "region"}
              anchor={anchor}
              contextElement={contextElement}
              kind={placingId ? null : draft.kind}
              placing={placingId !== null}
              onPick={(kind) => {
                if (kind === "delete") {
                  void save(draft, kind, "");
                  return;
                }
                setDraft((current) => (current?.from === "text" ? { ...current, kind } : current));
              }}
              onSave={(comment) => save(draft, draft.kind ?? "comment", comment)}
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
            onClose={() => setPanelOpen(false)}
            onShow={show}
            onPlaceAgain={(annotation) => setPlacingId(annotation?.id ?? null)}
            onSend={(annotations) => void send(annotations)}
          />
        </Suspense>
      </>
    ),
  };
}
