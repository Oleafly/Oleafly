import { useCallback, useDeferredValue, useEffect, useRef, useState } from "react";
import type {
  PdfLayout,
  PdfLoadState,
  PdfOutlineState,
  PdfPageColors,
  PdfRotation,
  PdfSearchState,
  PdfViewerHandle,
} from "@/components/pdf/PdfViewer";
import { useOverlayScrollbar } from "@/hooks/use-overlay-scrollbar";
import { cssColorToHex, readCssVariable } from "@/lib/css-color";
import { hexLuminance } from "@/lib/peer-colors";
import { useAppTheme, type Theme } from "@/lib/theme";
import { usePdfPosition } from "@/lib/use-pdf-position";
import { followPdfDarkModeInOtherWindows, useSettingsStore, type PdfDarkMode } from "@/store/settings";
import { attachPreviewZoom, MAX_PREVIEW_SCALE, MIN_PREVIEW_SCALE } from "./preview-zoom";
import { usePdfKeyboardShortcuts } from "./use-pdf-keyboard-shortcuts";

export type PdfFitMode = "width" | "height";

export const PDF_SCROLL_AXES = ["y", "x"] as const;

export const INITIAL_PDF_LOAD_STATE: PdfLoadState = { status: "idle", documentIdentity: "" };

export const INITIAL_PDF_SEARCH_STATE: PdfSearchState = {
  status: "idle",
  query: "",
  current: 0,
  total: 0,
  scannedPages: 0,
  totalPages: 0,
};

export const INITIAL_PDF_OUTLINE_STATE: PdfOutlineState = { status: "idle", items: [] };

function luminanceOf(variable: string): number | null {
  const hex = cssColorToHex(readCssVariable(variable));
  return hex ? hexLuminance(hex) : null;
}

export function readPdfPageColors(): PdfPageColors {
  const page = luminanceOf("--pdf-dark-page");
  const text = luminanceOf("--pdf-dark-text");
  return page !== null && text !== null && page > text ? "light" : "dark";
}

export function pdfDarkModeShown(mode: PdfDarkMode, theme: Theme, colors: PdfPageColors): boolean {
  if (mode === "follow") return theme === "dark" || colors === "light";
  return mode === "on";
}

function usePdfPageColors(observe: boolean): PdfPageColors {
  const [colors, setColors] = useState<PdfPageColors>(readPdfPageColors);
  useEffect(() => {
    if (!observe) return;
    const update = () => setColors(readPdfPageColors());
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style"] });
    return () => observer.disconnect();
  }, [observe]);
  return colors;
}

function usePdfDarkMode() {
  const mode = useSettingsStore((state) => state.pdfDarkMode);
  const setMode = useSettingsStore((state) => state.setPdfDarkMode);
  const theme = useAppTheme();
  const colors = usePdfPageColors(mode !== "off");
  useEffect(followPdfDarkModeInOtherWindows, []);
  const setShown = useCallback((shown: boolean) => setMode(shown ? "on" : "off"), [setMode]);
  return { shown: pdfDarkModeShown(mode, theme, colors), setShown, colors };
}

export interface PdfReaderOptions {
  readonly positionKey: string | null;
  readonly hasDocument: boolean;
  readonly surfaceKey?: unknown;
  readonly active?: boolean;
  readonly keyboard?: boolean;
  readonly onUserZoom?: () => void;
  readonly initialLoadState?: PdfLoadState;
}

export function usePdfReader({
  positionKey,
  hasDocument,
  surfaceKey,
  active = true,
  keyboard = true,
  onUserZoom,
  initialLoadState = INITIAL_PDF_LOAD_STATE,
}: PdfReaderOptions) {
  const [scale, setScale] = useState(1);
  const [fitMode, setFitMode] = useState<PdfFitMode | null>(null);
  const [layout, setLayout] = useState<PdfLayout>("single");
  const [rotation, setRotation] = useState<PdfRotation>(0);
  const [rotationPending, setRotationPending] = useState(false);
  const { shown: inverted, setShown: setInverted, colors } = usePdfDarkMode();
  const [screenReaderMode, setScreenReaderMode] = useState(false);
  const pdfPageColors = inverted && !screenReaderMode ? colors : undefined;
  const [page, setPage] = useState(1);
  const [numPages, setNumPages] = useState(0);
  const [pageInput, setPageInput] = useState("1");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const deferredSearch = useDeferredValue(searchInput);
  const [searchState, setSearchState] = useState<PdfSearchState>(INITIAL_PDF_SEARCH_STATE);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [outlineState, setOutlineState] = useState<PdfOutlineState>(INITIAL_PDF_OUTLINE_STATE);
  const [pdfLoadState, setPdfLoadState] = useState<PdfLoadState>(initialLoadState);
  const [pdfPassword, setPdfPassword] = useState("");
  const [passwordDraft, setPasswordDraft] = useState("");
  const [isFs, setIsFs] = useState(false);
  const [fsToolbarHidden, setFsToolbarHidden] = useState(false);

  const rootRef = useRef<HTMLDivElement>(null);
  const pdfRef = useRef<PdfViewerHandle>(null);
  const scrollBoxRef = useRef<HTMLElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const readyRotationRef = useRef(rotation);
  const userAdjustedZoomRef = useRef(false);
  const scaleRef = useRef(scale);
  scaleRef.current = scale;
  const onUserZoomRef = useRef(onUserZoom);
  onUserZoomRef.current = onUserZoom;

  const pdfPosition = usePdfPosition(positionKey, pdfRef, scrollBoxRef, rotation === readyRotationRef.current);
  useOverlayScrollbar(scrollBoxRef, PDF_SCROLL_AXES);

  const setClampedScale = useCallback((next: number) => {
    setScale(Math.min(MAX_PREVIEW_SCALE, Math.max(MIN_PREVIEW_SCALE, next)));
  }, []);

  const fitPreview = useCallback(
    (mode: PdfFitMode) => {
      const next = pdfRef.current?.getFitScale(mode);
      if (next === null || next === undefined) return false;
      setFitMode(mode);
      setClampedScale(next);
      return true;
    },
    [setClampedScale],
  );

  const userZoom = useCallback((mutate: () => void) => {
    userAdjustedZoomRef.current = true;
    onUserZoomRef.current?.();
    setFitMode(null);
    mutate();
  }, []);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else void rootRef.current?.requestFullscreen?.().catch(() => {});
  };

  const jumpToPage = () => {
    const requested = Number.parseInt(pageInput, 10);
    if (Number.isNaN(requested) || requested < 1 || requested > numPages) {
      setPageInput(String(page));
      return;
    }
    if (requested !== page) pdfRef.current?.gotoPage(requested);
  };

  const rotateClockwise = () => {
    if (!hasDocument) return;
    setRotationPending(true);
    setRotation((current) => ((current + 90) % 360) as PdfRotation);
  };

  const submitPassword = (identity: string, message: string) => {
    if (!passwordDraft) return;
    setPdfLoadState({ status: "loading", documentIdentity: identity, message });
    setPdfPassword(passwordDraft);
  };

  const markLoadState = (next: PdfLoadState) => {
    pdfPosition.onLoad(next);
    setPdfLoadState(next);
    if (next.status !== "loading") setRotationPending(false);
    if (next.status === "ready") readyRotationRef.current = rotation;
  };

  const markPage = (current: number, total: number) => {
    pdfPosition.onPage(current);
    setPage(current);
    setNumPages(total);
  };

  useEffect(() => {
    const onChange = () => {
      const fullscreen = document.fullscreenElement === rootRef.current;
      setIsFs(fullscreen);
      if (!fullscreen) setFsToolbarHidden(false);
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  useEffect(() => {
    setPageInput(String(page));
  }, [page]);

  useEffect(() => {
    if (numPages <= 1 && layout === "double") setLayout("single");
  }, [layout, numPages]);

  useEffect(() => {
    void surfaceKey;
    const element = scrollBoxRef.current;
    if (!element) return;
    return attachPreviewZoom(element, () => scaleRef.current, (updater) => userZoom(() => setScale(updater)));
  }, [surfaceKey, userZoom]);

  useEffect(() => {
    const element = scrollBoxRef.current;
    if (!element || !fitMode || !hasDocument || !active) return;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      if (frame) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        frame = 0;
        const next = pdfRef.current?.getFitScale(fitMode);
        if (next !== null && next !== undefined) setClampedScale(next);
      });
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [active, fitMode, hasDocument, setClampedScale]);

  usePdfKeyboardShortcuts({
    rootRef,
    enabled: keyboard,
    searchOpen,
    outlineOpen,
    searchInputRef,
    setSearchOpen,
    setSearchInput,
    setOutlineOpen,
    setRotation,
  });

  return {
    rootRef,
    pdfRef,
    scrollBoxRef,
    searchInputRef,
    userAdjustedZoomRef,
    scale,
    setScale,
    setClampedScale,
    fitMode,
    setFitMode,
    fitPreview,
    userZoom,
    layout,
    setLayout,
    rotation,
    setRotation,
    rotationPending,
    setRotationPending,
    rotateClockwise,
    inverted,
    setInverted,
    screenReaderMode,
    setScreenReaderMode,
    pdfPageColors,
    page,
    setPage,
    numPages,
    setNumPages,
    pageInput,
    setPageInput,
    jumpToPage,
    searchOpen,
    setSearchOpen,
    searchInput,
    setSearchInput,
    deferredSearch,
    searchState,
    setSearchState,
    outlineOpen,
    setOutlineOpen,
    outlineState,
    setOutlineState,
    pdfLoadState,
    setPdfLoadState,
    pdfPassword,
    setPdfPassword,
    passwordDraft,
    setPasswordDraft,
    submitPassword,
    markLoadState,
    markPage,
    isFs,
    fsToolbarHidden,
    setFsToolbarHidden,
    toggleFullscreen,
  };
}

export type PdfReader = ReturnType<typeof usePdfReader>;
