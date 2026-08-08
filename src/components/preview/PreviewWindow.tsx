import {
  useCallback,
  useDeferredValue,
  useEffect,
  useRef,
  useState,
} from "react";
import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  AlertTriangle,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Columns2,
  Contrast,
  Download,
  FileText,
  ListTree,
  Loader2,
  LockKeyhole,
  Minus,
  Plus,
  RectangleVertical,
  RotateCw,
  Search,
  TableOfContents,
  X,
} from "lucide-react";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import {
  PdfViewer,
  type PdfLayout,
  type PdfLoadState,
  type PdfOutlineItem,
  type PdfOutlineState,
  type PdfRotation,
  type PdfSearchState,
  type PdfViewerHandle,
} from "@/components/pdf/PdfViewer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip } from "@/components/ui/tooltip";
import {
  fingerprintCompileOutput,
  sameCompileOutput,
  type CompileSuccessCheckpoint,
} from "@/lib/compile-checkpoint";
import { pickSavePath } from "@/lib/native-file-dialog";
import {
  isPreviewWindowState,
  type PreviewWindowState,
} from "@/lib/preview-window";
import {
  readCompiledPdf,
  uint8ToBase64,
  writeBytesFile,
} from "@/lib/tauri";
import { cn } from "@/lib/utils";
import {
  attachPreviewZoom,
  MAX_PREVIEW_SCALE,
  MIN_PREVIEW_SCALE,
} from "./preview-zoom";

const INITIAL_LOAD_STATE: PdfLoadState = {
  status: "idle",
  documentIdentity: "",
};

const INITIAL_SEARCH_STATE: PdfSearchState = {
  status: "idle",
  query: "",
  current: 0,
  total: 0,
  scannedPages: 0,
  totalPages: 0,
};

const INITIAL_OUTLINE_STATE: PdfOutlineState = {
  status: "idle",
  items: [],
};

interface DetachedPreviewDocument {
  bytes: Uint8Array;
  checkpoint: CompileSuccessCheckpoint | null;
  identity: string;
}

interface InitialPreviewContext {
  projectId: string;
  state: PreviewWindowState | null;
}

function readInitialPreviewContext(): InitialPreviewContext {
  const params = new URLSearchParams(window.location.search);
  const projectId = params.get("project")?.trim() ?? "";
  const serialized = params.get("state");
  if (!serialized || serialized.length > 32_768) {
    return { projectId, state: null };
  }
  try {
    const candidate: unknown = JSON.parse(serialized);
    if (
      isPreviewWindowState(candidate) &&
      (!projectId || candidate.identity.projectId === projectId)
    ) {
      return {
        projectId: candidate.identity.projectId,
        state: candidate,
      };
    }
  } catch {
    // A malformed query payload is ignored and never used to select a file.
  }
  return { projectId, state: null };
}

function checkpointIdentity(
  checkpoint: CompileSuccessCheckpoint | null,
  byteLength: number,
): string {
  if (!checkpoint) return `preview-harness:${byteLength}`;
  return JSON.stringify({
    projectId: checkpoint.projectId,
    mainDocument: checkpoint.mainDocument,
    projectRevision: checkpoint.projectRevision,
    requestGeneration: checkpoint.requestGeneration,
    outputRevision: checkpoint.outputRevision,
    outputId: checkpoint.outputId,
  });
}

function previewStateKey(state: PreviewWindowState): string {
  return JSON.stringify({
    identity: state.identity,
    status: state.status,
    outputRevision: state.checkpoint?.outputRevision ?? null,
    outputId: state.checkpoint?.outputId ?? null,
  });
}

function checkpointMatchesCurrentState(
  checkpoint: CompileSuccessCheckpoint | null,
  state: PreviewWindowState | null,
): boolean {
  return (
    checkpoint !== null &&
    state?.status === "success" &&
    state.checkpoint !== null &&
    sameCompileOutput(checkpoint, state.checkpoint) &&
    checkpoint.mainDocument === state.identity.mainDocument &&
    checkpoint.projectRevision === state.identity.projectRevision &&
    checkpoint.requestGeneration === state.identity.requestGeneration
  );
}

function shouldAcceptPreviewState(
  candidate: PreviewWindowState,
  current: PreviewWindowState | null,
): boolean {
  if (!current || current.identity.projectId !== candidate.identity.projectId) {
    return true;
  }
  // Project revision is shared across producers/windows even though request
  // generation is not. Once a newer whole-project revision is announced, a
  // delayed success for an older dependency graph cannot become current just
  // because its backend output revision is numerically newer.
  if (
    candidate.identity.projectRevision <
    current.identity.projectRevision
  ) {
    return false;
  }
  // Backend output revisions are process-wide, whereas request generations
  // are local to one producer window. A successful compile from another
  // window therefore wins by output revision even when its local request
  // generation is numerically smaller.
  if (candidate.status === "success" && candidate.checkpoint) {
    return (
      candidate.identity.projectRevision >
        current.identity.projectRevision ||
      !current.checkpoint ||
      candidate.checkpoint.outputRevision >=
        current.checkpoint.outputRevision
    );
  }
  if (
    candidate.identity.requestGeneration !==
    current.identity.requestGeneration
  ) {
    return (
      candidate.identity.requestGeneration >
      current.identity.requestGeneration
    );
  }
  const currentRevision = current.checkpoint?.outputRevision ?? 0;
  const candidateRevision = candidate.checkpoint?.outputRevision ?? 0;
  if (candidateRevision < currentRevision) return false;

  const rank = (status: PreviewWindowState["status"]) => {
    if (status === "success") return 3;
    if (status === "error" || status === "unavailable") return 2;
    if (status === "compiling") return 1;
    return 0;
  };
  return rank(candidate.status) >= rank(current.status);
}

function OutlineItems({
  items,
  onActivate,
  depth = 0,
}: {
  items: PdfOutlineItem[];
  onActivate: (id: string) => void;
  depth?: number;
}) {
  return (
    <ul className={cn(depth > 0 && "ml-3 border-l pl-1")}>
      {items.map((item) => (
        <li key={item.id}>
          <button
            type="button"
            disabled={Boolean(item.disabledReason)}
            title={item.disabledReason}
            className="flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left text-xs hover:bg-accent disabled:cursor-not-allowed disabled:opacity-45"
            onClick={() => onActivate(item.id)}
          >
            <span className="min-w-0 flex-1 truncate">{item.title}</span>
            {item.external && (
              <span className="text-[9px] uppercase text-muted-foreground">
                Link
              </span>
            )}
          </button>
          {item.children.length > 0 && (
            <OutlineItems
              items={item.children}
              onActivate={onActivate}
              depth={depth + 1}
            />
          )}
        </li>
      ))}
    </ul>
  );
}

function PreviewMessage({
  title,
  detail,
  loading = false,
  onRetry,
}: {
  title: string;
  detail: string;
  loading?: boolean;
  onRetry?: () => void;
}) {
  return (
    <div
      className="flex max-w-sm flex-col items-center gap-3 px-6 text-center"
      role={loading ? "status" : "alert"}
      aria-live="polite"
    >
      {loading ? (
        <Loader2 className="size-8 animate-spin text-muted-foreground motion-reduce:animate-none" />
      ) : (
        <FileText className="size-9 text-muted-foreground/50" />
      )}
      <div>
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
      </div>
      {onRetry && (
        <Button size="sm" variant="outline" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}

// Detached PDF preview window (`?view=preview`). Every disk read is accepted
// only after its checkpoint fingerprint matches; delayed loads and events can
// therefore never replace a newer document.
export interface PreviewWindowProps {
  /**
   * Component-harness seam for secondary-window coverage. Native E2E cannot
   * attach a second WebView through the bridge, so a browser harness supplies
   * deterministic bytes and disables only the Tauri event/read boundary.
   */
  harnessBytes?: Uint8Array;
  disableNativeBridge?: boolean;
}

export function PreviewWindow({
  harnessBytes,
  disableNativeBridge = false,
}: PreviewWindowProps = {}) {
  const [initialContext] = useState(readInitialPreviewContext);
  const harnessDocument = harnessBytes
    ? {
        bytes: harnessBytes,
        checkpoint: null,
        identity: checkpointIdentity(null, harnessBytes.byteLength),
      }
    : null;
  const [projectId, setProjectId] = useState(initialContext.projectId);
  const [compileState, setCompileState] =
    useState<PreviewWindowState | null>(initialContext.state);
  const [previewDocument, setPreviewDocument] =
    useState<DetachedPreviewDocument | null>(harnessDocument);
  const [artifactLoading, setArtifactLoading] = useState(false);
  const [artifactFailure, setArtifactFailure] = useState<string | null>(null);
  const [artifactRetry, setArtifactRetry] = useState(0);
  const [viewerReload, setViewerReload] = useState(0);
  const [pdfLoadState, setPdfLoadState] = useState<PdfLoadState>(
    harnessDocument
      ? {
          status: "loading",
          documentIdentity: harnessDocument.identity,
        }
      : INITIAL_LOAD_STATE,
  );
  const [scale, setScale] = useState(1);
  const [fitMode, setFitMode] = useState<"width" | "height" | null>(null);
  const [layout, setLayout] = useState<PdfLayout>("single");
  const [rotation, setRotation] = useState<PdfRotation>(0);
  const [inverted, setInverted] = useState(false);
  const [page, setPage] = useState(1);
  const [numPages, setNumPages] = useState(0);
  const [pageInput, setPageInput] = useState("1");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const deferredSearch = useDeferredValue(searchInput);
  const [searchState, setSearchState] = useState<PdfSearchState>(
    INITIAL_SEARCH_STATE,
  );
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [outlineState, setOutlineState] = useState<PdfOutlineState>(
    INITIAL_OUTLINE_STATE,
  );
  const [passwordDraft, setPasswordDraft] = useState("");
  const [pdfPassword, setPdfPassword] = useState("");
  const [retainedLoadFailure, setRetainedLoadFailure] = useState<string | null>(
    null,
  );
  const [exporting, setExporting] = useState(false);
  const [exportMessage, setExportMessage] = useState("");

  const rootRef = useRef<HTMLDivElement>(null);
  const pdfRef = useRef<PdfViewerHandle>(null);
  const scrollBoxRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const projectIdRef = useRef(projectId);
  const compileStateRef = useRef(compileState);
  const previewDocumentRef = useRef(previewDocument);
  const lastReadyDocumentRef =
    useRef<DetachedPreviewDocument | null>(harnessDocument);
  const artifactLoadGenerationRef = useRef(0);
  const projectStateRevisionRef = useRef(
    initialContext.state?.projectStateRevision ?? 0,
  );
  const scaleRef = useRef(scale);
  const userAdjustedZoomRef = useRef(false);
  projectIdRef.current = projectId;
  compileStateRef.current = compileState;
  previewDocumentRef.current = previewDocument;
  scaleRef.current = scale;

  const setClampedScale = useCallback((next: number) => {
    setScale(
      Math.min(MAX_PREVIEW_SCALE, Math.max(MIN_PREVIEW_SCALE, next)),
    );
  }, []);

  const fitPreview = useCallback(
    (mode: "width" | "height") => {
      const next = pdfRef.current?.getFitScale(mode);
      if (next !== null && next !== undefined) {
        setFitMode(mode);
        setClampedScale(next);
      }
    },
    [setClampedScale],
  );

  const userZoom = useCallback((mutate: () => void) => {
    userAdjustedZoomRef.current = true;
    setFitMode(null);
    mutate();
  }, []);

  const retargetProject = useCallback((nextProjectId: string) => {
    const normalized = nextProjectId.trim();
    if (!normalized || normalized.length > 4_096) return;
    ++artifactLoadGenerationRef.current;
    compileStateRef.current = null;
    setCompileState(null);
    setArtifactLoading(false);
    setArtifactFailure(null);
    setRetainedLoadFailure(null);
    setExportMessage("");
    if (projectIdRef.current !== normalized) {
      projectIdRef.current = normalized;
      setProjectId(normalized);
      previewDocumentRef.current = null;
      lastReadyDocumentRef.current = null;
      setPreviewDocument(null);
      setPdfLoadState(INITIAL_LOAD_STATE);
      setSearchState(INITIAL_SEARCH_STATE);
      setOutlineState(INITIAL_OUTLINE_STATE);
      setSearchInput("");
      setPdfPassword("");
      setPasswordDraft("");
      setPage(1);
      setNumPages(0);
      setRotation(0);
    }
  }, []);

  const acceptCompileState = useCallback(
    (candidate: unknown) => {
      if (!isPreviewWindowState(candidate)) return;
      if (
        candidate.projectStateRevision <
        projectStateRevisionRef.current
      ) {
        return;
      }
      // A fresh compile message may beat the corresponding backend mutation
      // event to this window. Advancing here prevents that later event from
      // clearing an output already stamped with the same/newer project epoch.
      projectStateRevisionRef.current = candidate.projectStateRevision;
      if (candidate.identity.projectId !== projectIdRef.current) {
        retargetProject(candidate.identity.projectId);
      }
      const displayedCheckpoint =
        previewDocumentRef.current?.checkpoint ?? null;
      if (
        candidate.status === "success" &&
        candidate.checkpoint &&
        displayedCheckpoint &&
        (candidate.checkpoint.outputRevision <
          displayedCheckpoint.outputRevision ||
          (candidate.checkpoint.outputRevision ===
            displayedCheckpoint.outputRevision &&
            compileStateRef.current !== null &&
            compileStateRef.current.status !== "success"))
      ) {
        return;
      }
      if (
        !shouldAcceptPreviewState(candidate, compileStateRef.current)
      ) {
        return;
      }
      compileStateRef.current = candidate;
      setCompileState(candidate);
      setArtifactFailure(null);
    },
    [retargetProject],
  );

  useEffect(() => {
    if (disableNativeBridge) return;
    const refreshListener = listen<unknown>(
      "preview:refresh",
      (event) => acceptCompileState(event.payload),
    );
    const projectListener = listen<unknown>(
      "preview:project",
      (event) => {
        const payload = event.payload;
        if (
          payload &&
          typeof payload === "object" &&
          "projectId" in payload &&
          typeof payload.projectId === "string"
        ) {
          retargetProject(payload.projectId);
        }
      },
    );
    const projectStateListener = listen<{ projectId?: string; revision?: number }>(
      "project-state-changed",
      (event) => {
        const revision = event.payload?.revision;
        if (
          event.payload?.projectId !== projectIdRef.current ||
          typeof revision !== "number" ||
          !Number.isSafeInteger(revision) ||
          revision <= projectStateRevisionRef.current
        ) {
          return;
        }
        projectStateRevisionRef.current = revision;
        // A source/main/engine/trust mutation makes the retained detached PDF
        // stale immediately. Wait for a new compile checkpoint rather than
        // continuing to present an artifact from the previous project state.
        ++artifactLoadGenerationRef.current;
        compileStateRef.current = null;
        previewDocumentRef.current = null;
        lastReadyDocumentRef.current = null;
        setCompileState(null);
        setPreviewDocument(null);
        setArtifactLoading(false);
        setArtifactFailure(null);
        setRetainedLoadFailure(null);
        setPdfLoadState(INITIAL_LOAD_STATE);
        setSearchState(INITIAL_SEARCH_STATE);
        setOutlineState(INITIAL_OUTLINE_STATE);
      },
    );
    return () => {
      ++artifactLoadGenerationRef.current;
      void refreshListener.then((unlisten) => unlisten());
      void projectListener.then((unlisten) => unlisten());
      void projectStateListener.then((unlisten) => unlisten());
    };
  }, [acceptCompileState, disableNativeBridge, retargetProject]);

  useEffect(() => {
    if (disableNativeBridge) return;
    void artifactRetry;
    const checkpoint = compileState?.checkpoint ?? null;
    if (
      compileState?.status !== "success" ||
      !checkpoint ||
      checkpoint.projectId !== projectId
    ) {
      setArtifactLoading(false);
      return;
    }
    if (
      sameCompileOutput(
        previewDocumentRef.current?.checkpoint ?? null,
        checkpoint,
      )
    ) {
      setArtifactLoading(false);
      return;
    }

    const generation = ++artifactLoadGenerationRef.current;
    const expectedStateKey = previewStateKey(compileState);
    setArtifactLoading(true);
    setArtifactFailure(null);
    void (async () => {
      try {
        const bytes = new Uint8Array(
          await readCompiledPdf(checkpoint.projectId),
        );
        if (
          generation !== artifactLoadGenerationRef.current ||
          projectIdRef.current !== checkpoint.projectId ||
          !compileStateRef.current ||
          previewStateKey(compileStateRef.current) !== expectedStateKey
        ) {
          return;
        }
        if (fingerprintCompileOutput(bytes) !== checkpoint.outputId) {
          throw new Error(
            "The compiled artifact changed before this window could verify it.",
          );
        }
        const nextDocument: DetachedPreviewDocument = {
          bytes,
          checkpoint,
          identity: checkpointIdentity(checkpoint, bytes.byteLength),
        };
        previewDocumentRef.current = nextDocument;
        setPreviewDocument(nextDocument);
        setPdfLoadState({
          status: "loading",
          documentIdentity: nextDocument.identity,
          message: "Loading verified PDF…",
        });
        setSearchState(INITIAL_SEARCH_STATE);
        setOutlineState({ status: "loading", items: [] });
        setSearchInput("");
        setPdfPassword("");
        setPasswordDraft("");
        setPage(1);
        setNumPages(0);
        setRotation(0);
        setRetainedLoadFailure(null);
        setArtifactFailure(null);
        setArtifactLoading(false);
        userAdjustedZoomRef.current = false;
      } catch {
        if (
          generation !== artifactLoadGenerationRef.current ||
          projectIdRef.current !== checkpoint.projectId ||
          !compileStateRef.current ||
          previewStateKey(compileStateRef.current) !== expectedStateKey
        ) {
          return;
        }
        setArtifactLoading(false);
        setArtifactFailure(
          "The compiled PDF could not be verified or read. The last successfully loaded PDF is retained when available.",
        );
      }
    })();
    return () => {
      if (generation === artifactLoadGenerationRef.current) {
        ++artifactLoadGenerationRef.current;
      }
    };
  }, [
    artifactRetry,
    compileState,
    disableNativeBridge,
    projectId,
  ]);

  useEffect(() => {
    setPageInput(String(page));
  }, [page]);

  useEffect(() => {
    if (numPages <= 1 && layout === "double") setLayout("single");
  }, [layout, numPages]);

  useEffect(() => {
    const element = scrollBoxRef.current;
    if (!element) return;
    return attachPreviewZoom(
      element,
      () => scaleRef.current,
      (updater) => {
        userAdjustedZoomRef.current = true;
        setFitMode(null);
        setScale(updater);
      },
    );
  }, []);

  useEffect(() => {
    const element = scrollBoxRef.current;
    if (!element || !fitMode || !previewDocument) return;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      if (frame) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        frame = 0;
        const next = pdfRef.current?.getFitScale(fitMode);
        if (next !== null && next !== undefined) {
          setClampedScale(next);
        }
      });
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [fitMode, previewDocument, setClampedScale]);

  const autoFitIdentityRef = useRef("");
  useEffect(() => {
    if (
      !previewDocument ||
      numPages < 1 ||
      autoFitIdentityRef.current === previewDocument.identity ||
      userAdjustedZoomRef.current
    ) {
      return;
    }
    autoFitIdentityRef.current = previewDocument.identity;
    const frame = requestAnimationFrame(() => {
      if (!userAdjustedZoomRef.current) fitPreview("height");
    });
    return () => cancelAnimationFrame(frame);
  }, [fitPreview, numPages, previewDocument]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const modifier = event.metaKey || event.ctrlKey;
      if (modifier && event.key.toLowerCase() === "f") {
        event.preventDefault();
        setSearchOpen(true);
        requestAnimationFrame(() =>
          searchInputRef.current?.focus({ preventScroll: true }),
        );
        return;
      }
      if (event.key === "Escape") {
        if (searchOpen) {
          setSearchOpen(false);
          setSearchInput("");
        } else if (outlineOpen) {
          setOutlineOpen(false);
        }
        return;
      }
      const target = event.target as HTMLElement | null;
      if (
        target?.matches("input, textarea, select") ||
        target?.isContentEditable
      ) {
        return;
      }
      if (modifier && (event.key === "+" || event.key === "=")) {
        event.preventDefault();
        userZoom(() =>
          setScale((current) =>
            Math.min(MAX_PREVIEW_SCALE, current + 0.2),
          ),
        );
      } else if (modifier && event.key === "-") {
        event.preventDefault();
        userZoom(() =>
          setScale((current) =>
            Math.max(MIN_PREVIEW_SCALE, current - 0.2),
          ),
        );
      } else if (modifier && event.key === "0") {
        event.preventDefault();
        userZoom(() => setScale(1));
      } else if (
        modifier &&
        event.shiftKey &&
        event.key.toLowerCase() === "r"
      ) {
        event.preventDefault();
        setRotation(
          (current) => ((current + 90) % 360) as PdfRotation,
        );
      }
    };
    root.addEventListener("keydown", onKeyDown);
    return () => root.removeEventListener("keydown", onKeyDown);
  }, [outlineOpen, searchOpen, userZoom]);

  const jumpToPage = () => {
    const requested = Number.parseInt(pageInput, 10);
    if (
      Number.isNaN(requested) ||
      requested < 1 ||
      requested > numPages
    ) {
      setPageInput(String(page));
      return;
    }
    if (requested !== page) pdfRef.current?.gotoPage(requested);
  };

  const handlePdfLoadState = (next: PdfLoadState) => {
    const current = previewDocumentRef.current;
    if (!current || current.identity !== next.documentIdentity) return;
    setPdfLoadState(next);
    if (next.status === "ready") {
      lastReadyDocumentRef.current = current;
      setRetainedLoadFailure(null);
      return;
    }
    if (
      next.status !== "invalid" &&
      next.status !== "empty" &&
      next.status !== "unavailable" &&
      next.status !== "error"
    ) {
      return;
    }
    const fallback = lastReadyDocumentRef.current;
    if (
      !fallback ||
      fallback.identity === current.identity ||
      fallback.checkpoint?.projectId !== current.checkpoint?.projectId
    ) {
      return;
    }
    previewDocumentRef.current = fallback;
    setPreviewDocument(fallback);
    setPdfLoadState({
      status: "loading",
      documentIdentity: fallback.identity,
      message: "Restoring the last successfully loaded PDF…",
    });
    setRetainedLoadFailure(
      `${next.message ?? "The latest PDF could not be loaded"} Showing the last successfully loaded PDF instead.`,
    );
    setPdfPassword("");
    setPasswordDraft("");
  };

  const retryViewer = () => {
    const current = previewDocumentRef.current;
    if (!current) return;
    setPdfLoadState({
      status: "loading",
      documentIdentity: current.identity,
      message: "Retrying PDF load…",
    });
    setViewerReload((generation) => generation + 1);
  };

  const submitPassword = () => {
    if (!passwordDraft || !previewDocument) return;
    setPdfLoadState({
      status: "loading",
      documentIdentity: previewDocument.identity,
      message: "Unlocking PDF…",
    });
    setPdfPassword(passwordDraft);
  };

  const downloadDisplayedPdf = async () => {
    if (!previewDocument || exporting) return;
    const rawName =
      compileState?.identity.mainDocument
        .replace(/\.[^.]+$/u, "")
        .replace(/[^\w.-]+/gu, "_") || "document";
    const filename = `${rawName}.pdf`;
    setExporting(true);
    setExportMessage("");
    try {
      if (!isTauri()) {
        const objectUrl = URL.createObjectURL(
          new Blob([previewDocument.bytes.slice().buffer], {
            type: "application/pdf",
          }),
        );
        try {
          const anchor = document.createElement("a");
          anchor.href = objectUrl;
          anchor.download = filename;
          anchor.rel = "noopener";
          anchor.click();
        } finally {
          window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
        }
        setExportMessage("PDF download started.");
        return;
      }
      const destination = await pickSavePath({
        defaultPath: filename,
        filters: [{ name: "PDF", extensions: ["pdf"] }],
      });
      if (!destination) return;
      await writeBytesFile(
        destination,
        uint8ToBase64(previewDocument.bytes),
      );
      setExportMessage("PDF saved successfully.");
    } catch {
      setExportMessage("The displayed PDF could not be saved.");
    } finally {
      setExporting(false);
    }
  };

  const displayedIsCurrent = checkpointMatchesCurrentState(
    previewDocument?.checkpoint ?? null,
    compileState,
  );
  const displayedIsStale =
    previewDocument !== null &&
    !displayedIsCurrent &&
    !disableNativeBridge;
  const staleExplanation =
    retainedLoadFailure ??
    artifactFailure ??
    (compileState?.status === "compiling"
      ? `A newer project revision is compiling. This is the last verified PDF for revision ${previewDocument?.checkpoint?.projectRevision ?? "unknown"}.`
      : compileState?.status === "error" ||
          compileState?.status === "unavailable"
        ? `${compileState.message ?? "The newer compile did not produce a usable PDF"} The last verified PDF remains visible.`
        : "This PDF does not represent the latest accepted compile identity.");

  const rotateClockwise = () => {
    if (!previewDocument) return;
    setPdfLoadState({
      status: "loading",
      documentIdentity: previewDocument.identity,
      message: "Rotating PDF…",
    });
    setRotation(
      (current) => ((current + 90) % 360) as PdfRotation,
    );
  };

  return (
    <div
      ref={rootRef}
      data-testid="detached-preview-window"
      data-preview-layout={layout}
      data-preview-page={page}
      className="flex h-screen flex-col bg-background text-foreground"
    >
      <div className="flex min-h-10 shrink-0 flex-wrap items-center gap-1 border-b px-2 py-1 [&_button]:shrink-0">
        <Tooltip label="Document outline">
          <Button
            variant="ghost"
            size="icon"
            className={cn("size-7", outlineOpen && "bg-accent")}
            disabled={!previewDocument}
            onClick={() => setOutlineOpen((open) => !open)}
            aria-label="Document outline"
            aria-expanded={outlineOpen}
            aria-controls="detached-pdf-outline"
          >
            <ListTree className="size-3.5" />
          </Button>
        </Tooltip>
        <Tooltip label="Search PDF">
          <Button
            variant="ghost"
            size="icon"
            className={cn("size-7", searchOpen && "bg-accent")}
            disabled={!previewDocument}
            onClick={() => {
              setSearchOpen(true);
              requestAnimationFrame(() =>
                searchInputRef.current?.focus({
                  preventScroll: true,
                }),
              );
            }}
            aria-label="Search PDF"
            aria-expanded={searchOpen}
            aria-controls="detached-pdf-search"
          >
            <Search className="size-3.5" />
          </Button>
        </Tooltip>

        {numPages > 0 && (
          <>
            <div className="mx-1 h-4 w-px bg-border" />
            {/* A one-page document has nothing to lay out: hide the toggles entirely. */}
            {numPages > 1 && (
              <>
                <Tooltip label="Single page view">
                  <Button
                    variant="ghost"
                    size="icon"
                    className={cn(
                      "size-7",
                      layout === "single" && "bg-accent text-foreground",
                    )}
                    onClick={() => setLayout("single")}
                    aria-label="Single page view"
                    aria-pressed={layout === "single"}
                  >
                    <RectangleVertical className="size-3.5" />
                  </Button>
                </Tooltip>
                <Tooltip label="Two-page view">
                  <Button
                    variant="ghost"
                    size="icon"
                    className={cn(
                      "size-7",
                      layout === "double" && "bg-accent text-foreground",
                    )}
                    onClick={() => setLayout("double")}
                    aria-label="Two-page view"
                    aria-pressed={layout === "double"}
                  >
                    <Columns2 className="size-3.5" />
                  </Button>
                </Tooltip>
              </>
            )}
            <Tooltip label="Previous page">
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                disabled={page <= 1}
                onClick={() =>
                  pdfRef.current?.gotoPage(
                    page - (layout === "double" ? 2 : 1),
                  )
                }
                aria-label="Previous page"
              >
                <ChevronUp className="size-3.5" />
              </Button>
            </Tooltip>
            <div className="flex shrink-0 items-center gap-1 text-xs tabular-nums text-muted-foreground">
              <Input
                value={pageInput}
                onChange={(event) =>
                  setPageInput(
                    event.target.value.replace(/[^0-9]/gu, ""),
                  )
                }
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    jumpToPage();
                    event.currentTarget.blur();
                  }
                }}
                onBlur={jumpToPage}
                onFocus={(event) => event.target.select()}
                aria-label="Page number"
                className="h-7 w-10 px-1 text-center"
              />
              <span>of {numPages}</span>
            </div>
            <Tooltip label="Next page">
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                disabled={page >= numPages}
                onClick={() =>
                  pdfRef.current?.gotoPage(
                    page + (layout === "double" ? 2 : 1),
                  )
                }
                aria-label="Next page"
              >
                <ChevronDown className="size-3.5" />
              </Button>
            </Tooltip>
          </>
        )}

        <div className="ml-auto flex items-center gap-1">
          <Button
            variant={fitMode === "width" ? "secondary" : "ghost"}
            size="xs"
            disabled={!previewDocument}
            onClick={() => fitPreview("width")}
            aria-pressed={fitMode === "width"}
          >
            Fit width
          </Button>
          <Button
            variant={fitMode === "height" ? "secondary" : "ghost"}
            size="xs"
            disabled={!previewDocument}
            onClick={() => fitPreview("height")}
            aria-pressed={fitMode === "height"}
          >
            Fit to height
          </Button>
          <Tooltip label="Zoom out">
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              disabled={scale <= MIN_PREVIEW_SCALE}
              onClick={() =>
                userZoom(() =>
                  setScale((current) =>
                    Math.max(MIN_PREVIEW_SCALE, current - 0.2),
                  ),
                )
              }
              aria-label="Zoom out"
            >
              <Minus className="size-3.5" />
            </Button>
          </Tooltip>
          <span
            data-testid="detached-preview-zoom"
            className="w-10 text-center text-xs tabular-nums text-muted-foreground"
          >
            {Math.round(scale * 100)}%
          </span>
          <Tooltip label="Zoom in">
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              disabled={scale >= MAX_PREVIEW_SCALE}
              onClick={() =>
                userZoom(() =>
                  setScale((current) =>
                    Math.min(MAX_PREVIEW_SCALE, current + 0.2),
                  ),
                )
              }
              aria-label="Zoom in"
            >
              <Plus className="size-3.5" />
            </Button>
          </Tooltip>
          <Tooltip label="Rotate clockwise">
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              disabled={!previewDocument}
              onClick={rotateClockwise}
              aria-label="Rotate PDF clockwise"
            >
              <RotateCw className="size-3.5" />
            </Button>
          </Tooltip>
          <Tooltip label={inverted ? "Restore colors" : "Invert colors"}>
            <Button
              variant="ghost"
              size="icon"
              className={cn("size-7", inverted && "bg-accent")}
              disabled={!previewDocument}
              onClick={() => setInverted((value) => !value)}
              aria-label="Invert PDF colors"
              aria-pressed={inverted}
            >
              <Contrast className="size-3.5" />
            </Button>
          </Tooltip>
          <Tooltip label="Download displayed PDF">
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              disabled={!previewDocument || exporting}
              onClick={() => void downloadDisplayedPdf()}
              aria-label="Download displayed PDF"
            >
              {exporting ? (
                <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" />
              ) : (
                <Download className="size-3.5" />
              )}
            </Button>
          </Tooltip>
        </div>
      </div>

      {(displayedIsStale || retainedLoadFailure || artifactFailure) &&
        previewDocument && (
          <div
            className="flex shrink-0 items-start gap-2 border-b border-amber-500/40 bg-amber-500/15 px-3 py-2 text-amber-950 dark:text-amber-100"
            role="status"
            aria-live="polite"
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <div className="min-w-0 text-xs">
              <p className="font-semibold uppercase tracking-wide">
                Stale · non-current preview
              </p>
              <p>{staleExplanation}</p>
            </div>
            {artifactFailure && (
              <Button
                size="xs"
                variant="ghost"
                className="ml-auto shrink-0"
                onClick={() => setArtifactRetry((value) => value + 1)}
              >
                Retry
              </Button>
            )}
          </div>
        )}

      <div className="relative min-h-0 flex-1 overflow-hidden bg-sidebar">
        {/* Kept mounted while a document is loaded so closing animates too. */}
        {previewDocument && (
          <aside
            id="detached-pdf-outline"
            aria-label="PDF document outline"
            inert={!outlineOpen}
            className={cn(
              "absolute inset-y-2 left-2 z-30 flex w-[min(19rem,calc(100%-1rem))] flex-col overflow-hidden rounded-lg border bg-popover/80 text-popover-foreground shadow-xl backdrop-blur-xl supports-[not(backdrop-filter:blur(0))]:bg-popover",
              "transition-transform duration-200 ease-out motion-reduce:transition-none",
              outlineOpen ? "translate-x-0" : "-translate-x-[calc(100%_+_1rem)]",
            )}
          >
            <div className="flex min-h-11 items-center justify-between px-3">
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                <TableOfContents
                  aria-hidden
                  className="size-4 text-muted-foreground"
                />
                Document outline
              </h2>
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                onClick={() => setOutlineOpen(false)}
                aria-label="Close document outline"
              >
                <X className="size-3.5" />
              </Button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-2">
              {outlineState.status === "loading" ? (
                <p
                  className="flex items-center gap-2 px-2 py-3 text-xs text-muted-foreground"
                  role="status"
                >
                  <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" />
                  Loading outline…
                </p>
              ) : outlineState.items.length ? (
                <OutlineItems
                  items={outlineState.items}
                  onActivate={(id) => {
                    pdfRef.current?.activateOutlineItem(id);
                    setOutlineOpen(false);
                  }}
                />
              ) : (
                <p className="px-2 py-3 text-xs text-muted-foreground">
                  {outlineState.message ??
                    "This PDF does not contain a document outline."}
                </p>
              )}
            </div>
          </aside>
        )}

        {searchOpen && previewDocument && (
          <search
            id="detached-pdf-search"
            aria-label="Search this PDF"
            className="absolute right-2 top-2 z-30 flex max-w-[calc(100%-1rem)] items-center gap-1 rounded-lg border bg-popover p-1.5 text-popover-foreground shadow-xl"
          >
            <Search className="ml-1 size-3.5 shrink-0 text-muted-foreground" />
            <Input
              ref={searchInputRef}
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              onKeyDown={(event) => {
                if (
                  event.key === "Enter" &&
                  searchState.status === "success"
                ) {
                  if (event.shiftKey) {
                    pdfRef.current?.findPrevious();
                  } else {
                    pdfRef.current?.findNext();
                  }
                }
              }}
              placeholder="Search document"
              aria-label="Search PDF text"
              className="h-7 w-40 border-0 bg-transparent px-1 text-xs shadow-none focus-visible:ring-0"
            />
            <span
              className="min-w-14 text-center text-[11px] tabular-nums text-muted-foreground"
              aria-live="polite"
            >
              {searchState.status === "searching"
                ? `${searchState.scannedPages}/${searchState.totalPages}`
                : searchInput.trim()
                  ? `${searchState.current}/${searchState.total}`
                  : "0/0"}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              disabled={
                searchState.status !== "success" ||
                searchState.total === 0
              }
              onClick={() => pdfRef.current?.findPrevious()}
              aria-label="Previous search result"
            >
              <ChevronLeft className="size-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              disabled={
                searchState.status !== "success" ||
                searchState.total === 0
              }
              onClick={() => pdfRef.current?.findNext()}
              aria-label="Next search result"
            >
              <ChevronRight className="size-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              onClick={() => {
                setSearchOpen(false);
                setSearchInput("");
              }}
              aria-label="Close PDF search"
            >
              <X className="size-3.5" />
            </Button>
          </search>
        )}

        <section
          ref={scrollBoxRef}
          data-testid="detached-preview-scroll"
          data-pdf-scroll-root
          aria-label="PDF continuous scroll area"
          className="h-full overflow-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          style={
            inverted
              ? { filter: "invert(1) hue-rotate(180deg)" }
              : undefined
          }
        >
          {previewDocument ? (
            <ErrorBoundary
              resetKey={`${previewDocument.identity}:${viewerReload}`}
              fallback={
                <div className="flex h-full items-center justify-center">
                  <PreviewMessage
                    title="The PDF preview crashed"
                    detail="Retry this viewer or compile again in the main window."
                    onRetry={retryViewer}
                  />
                </div>
              }
            >
              <PdfViewer
                key={`${previewDocument.identity}:${viewerReload}`}
                ref={pdfRef}
                data={previewDocument.bytes}
                documentIdentity={previewDocument.identity}
                password={pdfPassword || undefined}
                rotation={rotation}
                scale={scale}
                layout={layout}
                searchQuery={searchOpen ? deferredSearch : ""}
                onLoadStateChange={handlePdfLoadState}
                onSearchStateChange={setSearchState}
                onOutlineStateChange={setOutlineState}
                onPageChange={(current, total) => {
                  setPage(current);
                  setNumPages(total);
                }}
              />
            </ErrorBoundary>
          ) : (
            <div className="flex h-full items-center justify-center">
              <PreviewMessage
                loading={
                  artifactLoading || compileState?.status === "compiling"
                }
                title={
                  compileState?.status === "compiling"
                    ? "Compiling PDF"
                    : compileState?.status === "error"
                      ? "Compile failed"
                      : compileState?.status === "unavailable"
                        ? "Compilation unavailable"
                        : artifactFailure
                          ? "PDF unavailable"
                          : "No verified PDF"
                }
                detail={
                  artifactFailure ??
                  compileState?.message ??
                  (compileState?.status === "compiling"
                    ? "The verified PDF will appear when compilation completes."
                    : "Compile the project in the main window. This window only displays output with a verified compile identity.")
                }
                onRetry={
                  artifactFailure
                    ? () => setArtifactRetry((value) => value + 1)
                    : undefined
                }
              />
            </div>
          )}
        </section>

        {previewDocument &&
          pdfLoadState.documentIdentity === previewDocument.identity &&
          pdfLoadState.status !== "ready" &&
          pdfLoadState.status !== "idle" && (
            <div className="absolute inset-0 z-20 flex items-center justify-center bg-sidebar/90 p-6 backdrop-blur-[1px]">
              {pdfLoadState.status === "password_required" ? (
                <form
                  className="w-full max-w-xs space-y-3 text-center"
                  onSubmit={(event) => {
                    event.preventDefault();
                    submitPassword();
                  }}
                >
                  <LockKeyhole className="mx-auto size-8 text-muted-foreground" />
                  <div>
                    <h2 className="text-sm font-semibold">
                      Password required
                    </h2>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {pdfLoadState.message}
                    </p>
                  </div>
                  <Input
                    autoFocus
                    type="password"
                    autoComplete="off"
                    value={passwordDraft}
                    onChange={(event) =>
                      setPasswordDraft(event.target.value)
                    }
                    aria-label="PDF password"
                    placeholder="PDF password"
                  />
                  <Button
                    type="submit"
                    size="sm"
                    disabled={!passwordDraft}
                  >
                    Unlock PDF
                  </Button>
                </form>
              ) : (
                <PreviewMessage
                  loading={pdfLoadState.status === "loading"}
                  title={
                    pdfLoadState.status === "loading"
                      ? "Loading PDF"
                      : pdfLoadState.status === "invalid"
                        ? "Invalid PDF"
                        : pdfLoadState.status === "empty"
                          ? "Empty PDF"
                          : pdfLoadState.status === "unavailable"
                            ? "PDF viewer unavailable"
                            : "PDF load failed"
                  }
                  detail={
                    pdfLoadState.status === "loading" &&
                    pdfLoadState.progress !== undefined
                      ? `${Math.round(pdfLoadState.progress * 100)}%`
                      : pdfLoadState.message ??
                        "The PDF could not be loaded."
                  }
                  onRetry={
                    pdfLoadState.status === "loading"
                      ? undefined
                      : retryViewer
                  }
                />
              )}
            </div>
          )}
      </div>

      <div className="sr-only" aria-live="polite">
        {exportMessage}
      </div>
    </div>
  );
}
