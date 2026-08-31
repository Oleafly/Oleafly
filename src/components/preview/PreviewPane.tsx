import {
  Fragment,
  useCallback,
  useDeferredValue,
  useEffect,
  useRef,
  useState,
} from "react";
import { isTauri } from "@tauri-apps/api/core";
import {
  AlertTriangle,
  Accessibility,
  CheckCircle2,
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
  MoreHorizontal,
  LockKeyhole,
  Maximize,
  Minus,
  Minimize,
  PanelTopClose,
  PanelTopOpen,
  Play,
  RectangleVertical,
  RotateCw,
  Save,
  ScrollText,
  Search,
  TableOfContents,
  Sparkles,
  SquareArrowOutUpRight,
  X,
  XCircle,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Tooltip } from "@/components/ui/tooltip";
import { useModalAccessibility } from "@/components/ui/use-modal-accessibility";
import {
  PdfViewer,
  type PdfLoadState,
  type PdfOutlineState,
  type PdfRotation,
  type PdfSearchState,
  type PdfViewerHandle,
  type PdfLayout,
} from "@/components/pdf/PdfViewer";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { LogPane } from "@/components/editor/LogPane";
import {
  isCompileCheckpointCurrent,
  useCompileStore,
  type CompilePhase,
  type CompileStatus,
} from "@/store/compile";
import { useFilesStore } from "@/store/files";
import { usePdfViewStore } from "@/store/pdf-view";
import { useSettingsStore } from "@/store/settings";
import { SidebarCollapseToggle } from "@/components/layout/WorkspaceControls";
import { useProjectAnalysisStore } from "@/store/project-analysis";
import { useTourStore } from "@/store/tours";
import {
  canUseSyncTexForCheckpoint,
  inverseFromClick,
} from "@/features/synctex";
import { askAiAboutCompileErrors } from "@/features/ask-ai-compile-errors";
import {
  revealInDir,
  saveFileBase64,
  uint8ToBase64,
  writeBytesFile,
} from "@/lib/tauri";
import { pickSavePath } from "@/lib/native-file-dialog";
import {
  openPreviewWindow,
  type PreviewWindowStateInput,
} from "@/lib/preview-window";
import type { CompileSuccessCheckpoint } from "@/lib/compile-checkpoint";
import type {
  LanguageServiceReadiness,
  ProjectAnalysisStatus,
} from "@/lib/analysis/project-snapshot";
import { notifyError, toast } from "@/lib/toast";
import { cn, shortcut } from "@/lib/utils";
import {
  DIVIDER_WIDTH,
  ICON_BUTTON_WIDTH,
  fitCount,
  useAvailableWidth,
  type ToolbarControl,
} from "@/components/ui/toolbar-overflow";
import {
  attachPreviewZoom,
  MAX_PREVIEW_SCALE,
  MIN_PREVIEW_SCALE,
} from "./preview-zoom";

const ZOOM_PRESETS = [0.25, 0.5, 0.75, 1, 1.5, 2, 4];

const PAGE_LAYOUTS: readonly {
  value: PdfLayout;
  label: string;
  icon: typeof RectangleVertical;
}[] = [
  { value: "single", label: "Single page view", icon: RectangleVertical },
  { value: "double", label: "Two-page view", icon: Columns2 },
];

interface PreviewDocument {
  bytes: Uint8Array;
  checkpoint: CompileSuccessCheckpoint | null;
  identity: string;
}

const INITIAL_PDF_LOAD_STATE: PdfLoadState = {
  status: "idle",
  documentIdentity: "",
};

const INITIAL_PDF_SEARCH_STATE: PdfSearchState = {
  status: "idle",
  query: "",
  current: 0,
  total: 0,
  scannedPages: 0,
  totalPages: 0,
};

const INITIAL_PDF_OUTLINE_STATE: PdfOutlineState = {
  status: "idle",
  items: [],
};

type StartupStageStatus =
  | "pending"
  | "running"
  | "complete"
  | "skipped"
  | "error";

interface DocumentStartupStage {
  id: "language-service" | "analysis" | "compile" | "render";
  label: string;
  detail: string;
  status: StartupStageStatus;
}

interface DocumentStartupState {
  projectActive: boolean;
  projectLoading: boolean;
  engineLoaded: boolean;
  languageReadiness: LanguageServiceReadiness;
  languageReason: string;
  analysisStatus: ProjectAnalysisStatus;
  analysisReason: string;
  compileStatus: CompileStatus;
  compilePhase: CompilePhase;
  compileCurrent: boolean;
  compileFailureReason: string | null;
  hasPdfCandidate: boolean;
  viewerIdentity: string | null;
  pdfCurrent: boolean;
  pdfLoadState: PdfLoadState;
  retainedLoadFailure: string | null;
}

function languageServiceStartupStage(
  state: DocumentStartupState,
): DocumentStartupStage {
  if (!state.projectActive) {
    return {
      id: "language-service",
      label: "Language service",
      detail: "No active project",
      status: "skipped",
    };
  }
  if (state.projectLoading) {
    return {
      id: "language-service",
      label: "Language service",
      detail: "Opening project files",
      status: "running",
    };
  }

  switch (state.languageReadiness) {
    case "starting":
      return {
        id: "language-service",
        label: "Language service",
        detail: state.languageReason || "Starting language service",
        status: "running",
      };
    case "restarting":
      return {
        id: "language-service",
        label: "Language service",
        detail: state.languageReason || "Restarting language service",
        status: "running",
      };
    case "installing":
      return {
        id: "language-service",
        label: "Language service",
        detail: state.languageReason || "Installing language service",
        status: "running",
      };
    case "syncing":
      return {
        id: "language-service",
        label: "Language service",
        detail: "Started and connected",
        status: "complete",
      };
    case "ready":
      return {
        id: "language-service",
        label: "Language service",
        detail: "Ready",
        status: "complete",
      };
    case "local_only":
      return {
        id: "language-service",
        label: "Language service",
        detail: "Not required. Using local analysis.",
        status: "skipped",
      };
    case "unsupported":
    case "stopped":
      return {
        id: "language-service",
        label: "Language service",
        detail: state.languageReason || "Not applicable for this project",
        status: "skipped",
      };
    case "setup_required":
    case "unavailable":
      return {
        id: "language-service",
        label: "Language service",
        detail:
          state.languageReason ||
          "Unavailable. Local analysis remains available.",
        status: "skipped",
      };
    case "not_run":
      return {
        id: "language-service",
        label: "Language service",
        detail: state.engineLoaded
          ? state.languageReason || "Waiting to start"
          : "Waiting for document engine",
        status: state.engineLoaded ? "pending" : "running",
      };
  }
}

function languageAnalysisStartupStage(
  state: DocumentStartupState,
): DocumentStartupStage {
  if (!state.projectActive) {
    return {
      id: "analysis",
      label: "Language analysis",
      detail: "No active project",
      status: "skipped",
    };
  }
  if (state.projectLoading) {
    return {
      id: "analysis",
      label: "Language analysis",
      detail: "Waiting for project files",
      status: "pending",
    };
  }
  if (
    state.languageReadiness === "syncing" ||
    state.analysisStatus === "running" ||
    (state.analysisStatus === "partial" &&
      /rebuild|building|running|sync/iu.test(state.analysisReason))
  ) {
    return {
      id: "analysis",
      label: "Language analysis",
      detail:
        state.analysisReason ||
        (state.languageReadiness === "syncing"
          ? "Synchronizing current project files"
          : "Analyzing project structure"),
      status: "running",
    };
  }

  switch (state.analysisStatus) {
    case "success":
      return {
        id: "analysis",
        label: "Language analysis",
        detail: "Current project revision analyzed",
        status: "complete",
      };
    case "partial":
      return {
        id: "analysis",
        label: "Language analysis",
        detail: state.analysisReason || "Usable partial analysis is ready",
        status: "complete",
      };
    case "error":
      return {
        id: "analysis",
        label: "Language analysis",
        detail: state.analysisReason || "Analysis needs attention",
        status: "error",
      };
    case "unsupported":
    case "unavailable":
      return {
        id: "analysis",
        label: "Language analysis",
        detail: state.analysisReason || "Not available for this project",
        status: "skipped",
      };
    case "not_run":
      if (
        state.languageReadiness === "setup_required" ||
        state.languageReadiness === "unavailable" ||
        state.languageReadiness === "unsupported" ||
        state.languageReadiness === "stopped"
      ) {
        return {
          id: "analysis",
          label: "Language analysis",
          detail: state.analysisReason || "Not available for this project",
          status: "skipped",
        };
      }
      return {
        id: "analysis",
        label: "Language analysis",
        detail: state.analysisReason || "Queued for the current revision",
        status: "pending",
      };
  }
}

function compileStartupStage(
  state: DocumentStartupState,
): DocumentStartupStage {
  if (!state.projectActive) {
    return {
      id: "compile",
      label: "Compiling",
      detail: "No active project",
      status: "skipped",
    };
  }
  if (state.compileStatus === "compiling") {
    const detail =
      state.compilePhase === "saving"
        ? "Saving current changes"
        : state.compilePhase === "downloading"
          ? "Downloading required LaTeX packages"
          : "Producing and verifying PDF output";
    return {
      id: "compile",
      label: "Compiling",
      detail,
      status: "running",
    };
  }
  if (
    state.compileStatus === "error" ||
    state.compileStatus === "unavailable"
  ) {
    return {
      id: "compile",
      label: "Compiling",
      detail:
        state.compileFailureReason ||
        (state.compileStatus === "unavailable"
          ? "Compiler unavailable"
          : "Compile failed. Open Logs for details."),
      status: "error",
    };
  }
  if (state.compileCurrent) {
    return {
      id: "compile",
      label: "Compiling",
      detail: "Verified output accepted",
      status: "complete",
    };
  }
  return {
    id: "compile",
    label: "Compiling",
    detail: state.engineLoaded
      ? "Waiting to compile the current revision"
      : "Waiting for document engine",
    status: "pending",
  };
}

function renderStartupStage(
  state: DocumentStartupState,
): DocumentStartupStage {
  const loadMatchesViewer =
    state.viewerIdentity !== null &&
    state.pdfLoadState.documentIdentity === state.viewerIdentity;
  if (loadMatchesViewer && state.pdfLoadState.status === "loading") {
    return {
      id: "render",
      label: "Rendering PDF",
      detail:
        state.pdfLoadState.progress === undefined
          ? "Preparing pages, text, and links"
          : `Reading PDF · ${Math.round(state.pdfLoadState.progress * 100)}%`,
      status: "running",
    };
  }
  if (
    state.retainedLoadFailure ||
    (loadMatchesViewer &&
      (state.pdfLoadState.status === "empty" ||
        state.pdfLoadState.status === "invalid" ||
        state.pdfLoadState.status === "unavailable" ||
        state.pdfLoadState.status === "error" ||
        state.pdfLoadState.status === "password_required"))
  ) {
    return {
      id: "render",
      label: "Rendering PDF",
      detail:
        state.retainedLoadFailure ||
        state.pdfLoadState.message ||
        (state.pdfLoadState.status === "password_required"
          ? "Password required"
          : "PDF rendering needs attention"),
      status: "error",
    };
  }
  if (
    state.pdfCurrent &&
    loadMatchesViewer &&
    state.pdfLoadState.status === "ready"
  ) {
    return {
      id: "render",
      label: "Rendering PDF",
      detail: "Preview ready",
      status: "complete",
    };
  }
  if (
    state.compileStatus === "success" &&
    state.hasPdfCandidate
  ) {
    return {
      id: "render",
      label: "Rendering PDF",
      detail: "Waiting for the verified PDF renderer",
      status: "running",
    };
  }
  return {
    id: "render",
    label: "Rendering PDF",
    detail: "Waiting for verified compile output",
    status: "pending",
  };
}

// The language service and the analysis it feeds are one step to the reader:
// showing them apart lets analysis report "complete" above a service that is
// still starting, which reads as an out-of-order checklist. Merge them so the
// row only settles once both halves have.
function mergedLanguageStartupStage(
  state: DocumentStartupState,
): DocumentStartupStage {
  const service = languageServiceStartupStage(state);
  const analysis = languageAnalysisStartupStage(state);
  const merge = (status: StartupStageStatus, detail: string) => ({
    id: "analysis" as const,
    label: "Language analysis",
    detail,
    status,
  });

  const analysisSettled =
    analysis.status === "complete" || analysis.status === "skipped";
  for (const status of ["error", "running", "pending"] as const) {
    // Analysis speaks for the pair whenever it has something to say, since its
    // detail names the project revision the reader is waiting on.
    if (analysis.status === status) return merge(status, analysis.detail);
    if (service.status === status) {
      // Service details are written for a row of their own and can read as
      // "language analysis has not run" even after it has. Speak for the pair.
      return merge(
        status,
        analysisSettled ? "Waiting for the language service" : service.detail,
      );
    }
  }
  // Analysis is the payload of the pair: if it cannot run, the row is skipped
  // even when the service itself started fine.
  if (analysis.status === "skipped") return merge("skipped", analysis.detail);
  return merge("complete", analysis.detail);
}

function documentStartupStages(
  state: DocumentStartupState,
): DocumentStartupStage[] {
  return [
    mergedLanguageStartupStage(state),
    compileStartupStage(state),
    renderStartupStage(state),
  ];
}

function checkpointIdentity(
  checkpoint: CompileSuccessCheckpoint | null,
  bytes: Uint8Array,
): string {
  if (!checkpoint) {
    return JSON.stringify({
      projectId: "unverified",
      mainDocument: "unknown",
      projectRevision: -1,
      requestGeneration: -1,
      outputRevision: -1,
      byteLength: bytes.byteLength,
    });
  }
  return JSON.stringify({
    projectId: checkpoint.projectId,
    mainDocument: checkpoint.mainDocument,
    projectRevision: checkpoint.projectRevision,
    requestGeneration: checkpoint.requestGeneration,
    outputRevision: checkpoint.outputRevision,
    outputId: checkpoint.outputId,
  });
}

function previewWindowState(
  status: ReturnType<typeof useCompileStore.getState>["status"],
  identity: ReturnType<
    typeof useCompileStore.getState
  >["lastAttemptIdentity"],
  checkpoint: CompileSuccessCheckpoint | null,
  message: string | null,
): PreviewWindowStateInput | undefined {
  const resolvedIdentity =
    identity ??
    (checkpoint
      ? {
          projectId: checkpoint.projectId,
          mainDocument: checkpoint.mainDocument,
          projectRevision: checkpoint.projectRevision,
          requestGeneration: checkpoint.requestGeneration,
        }
      : null);
  if (!resolvedIdentity) return undefined;
  const statusValue =
    status === "idle"
      ? "not_run"
      : status;
  const exactCheckpoint =
    checkpoint &&
    checkpoint.projectId === resolvedIdentity.projectId &&
    checkpoint.mainDocument === resolvedIdentity.mainDocument &&
    checkpoint.projectRevision ===
      resolvedIdentity.projectRevision &&
    checkpoint.requestGeneration ===
      resolvedIdentity.requestGeneration
      ? checkpoint
      : null;
  return {
    identity: resolvedIdentity,
    status: statusValue,
    checkpoint:
      statusValue === "success" ? exactCheckpoint : null,
    ...(message ? { message } : {}),
  };
}

export function PreviewPane() {
  const status = useCompileStore((s) => s.status);
  const phase = useCompileStore((s) => s.phase);
  const pdfBytes = useCompileStore((s) => s.pdfBytes);
  const recompile = useCompileStore((s) => s.recompile);
  const errors = useCompileStore((s) => s.errors);
  const compileTimeMs = useCompileStore((s) => s.compileTimeMs);
  const compileCheckpoint = useCompileStore(
    (state) => state.lastCompileCheckpoint,
  );
  const lastAttemptIdentity = useCompileStore(
    (state) => state.lastAttemptIdentity,
  );
  const compileFailureReason = useCompileStore(
    (state) => state.failureReason,
  );
  const projectId = useFilesStore((s) => s.projectId);
  const projectName = useFilesStore((s) => s.projectName);
  const refreshTree = useFilesStore((s) => s.refreshTree);
  const mainDoc = useFilesStore((s) => s.mainDoc);
  const projectLoading = useFilesStore((s) => s.loading);
  const engineLoaded = useFilesStore((s) => s.engineLoaded);
  const projectRevision = useProjectAnalysisStore((state) =>
    state.snapshot.identity.projectId === projectId
      ? state.snapshot.identity.projectRevision
      : 0,
  );
  const languageReadiness = useProjectAnalysisStore(
    (state): LanguageServiceReadiness =>
      state.snapshot.identity.projectId === projectId
        ? state.snapshot.languageService.readiness
        : "not_run",
  );
  const languageReason = useProjectAnalysisStore((state) =>
    state.snapshot.identity.projectId === projectId
      ? (state.snapshot.languageService.reason ?? "")
      : "",
  );
  const analysisStatus = useProjectAnalysisStore(
    (state): ProjectAnalysisStatus =>
      state.snapshot.identity.projectId === projectId
        ? state.snapshot.projectIndex.status
        : "not_run",
  );
  const analysisReason = useProjectAnalysisStore((state) => {
    if (state.snapshot.identity.projectId !== projectId) return "";
    const slot = state.snapshot.projectIndex;
    if ("failure" in slot) return slot.failure.message;
    return "reason" in slot ? (slot.reason ?? "") : "";
  });
  // Image and diagram projects render a single figure: no pages/spreads, "PDF" reads as "image".
  const projectKindForPreview = useFilesStore((s) => s.projectKind);
  const isImage = projectKindForPreview === "image" || projectKindForPreview === "diagram";
  const inverted = useSettingsStore((state) => state.pdfDarkMode);
  const setInverted = useSettingsStore((state) => state.setPdfDarkMode);
  const viewMode = useSettingsStore((state) => state.viewMode);
  const pdfZoomShortcuts = useSettingsStore(
    (state) => state.pdfZoomShortcuts,
  );
  const [screenReaderMode, setScreenReaderMode] = useState(false);
  const [scale, setScale] = useState(1.0);
  const [zoomMenuOpen, setZoomMenuOpen] = useState(false);
  const [tab, setTab] = useState<"pdf" | "logs">("pdf");
  const activeTourId = useTourStore((state) => state.activeTourId);
  const tourTabRef = useRef<"pdf" | "logs" | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [page, setPage] = useState(1);
  const [numPages, setNumPages] = useState(0);
  const [pageInput, setPageInput] = useState("1");
  const [layout, setLayout] = useState<PdfLayout>("single");
  const [rotation, setRotation] = useState<PdfRotation>(0);
  const [fitMode, setFitMode] = useState<"width" | "height" | null>(
    null,
  );
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const deferredSearch = useDeferredValue(searchInput);
  const [searchState, setSearchState] = useState<PdfSearchState>(
    INITIAL_PDF_SEARCH_STATE,
  );
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [outlineState, setOutlineState] = useState<PdfOutlineState>(
    INITIAL_PDF_OUTLINE_STATE,
  );
  const [pdfLoadState, setPdfLoadState] = useState<PdfLoadState>(
    INITIAL_PDF_LOAD_STATE,
  );
  const [pdfPassword, setPdfPassword] = useState("");
  const [pdfReloadGeneration, setPdfReloadGeneration] = useState(0);
  // Rotation is a dependency of PdfViewer's document-load effect, so turning
  // the page re-parses the PDF. That work belongs on the rotate button, not
  // behind the startup overlay.
  const [rotationPending, setRotationPending] = useState(false);
  // Whether this pane has ever completed a render for the current project. The
  // multi-stage startup panel explains a wait with nothing on screen; once a
  // page is up, replacing it with that panel on every recompile is a flicker,
  // so later loads keep the previous render visible instead.
  const [hasRendered, setHasRendered] = useState(false);
  const [passwordDraft, setPasswordDraft] = useState("");
  const [viewerDocument, setViewerDocument] =
    useState<PreviewDocument | null>(null);
  const [retainedLoadFailure, setRetainedLoadFailure] = useState<
    string | null
  >(null);
  const [isFs, setIsFs] = useState(false);
  const [fsToolbarHidden, setFsToolbarHidden] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const pdfRef = useRef<PdfViewerHandle>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const scrollBoxRef = useRef<HTMLDivElement>(null);
  const scaleRef = useRef(scale);
  const lastReadyDocumentRef = useRef<PreviewDocument | null>(null);
  const rejectedDocumentIdentitiesRef = useRef(new Set<string>());
  const closeSave = () => setSaveOpen(false);
  const { dialogRef: saveDialogRef, onBackdropMouseDown: onSaveBackdropMouseDown } =
    useModalAccessibility<HTMLDivElement>(saveOpen, closeSave);
  scaleRef.current = scale;

  useEffect(() => {
    void projectId;
    lastReadyDocumentRef.current = null;
    rejectedDocumentIdentitiesRef.current.clear();
    setViewerDocument(null);
    setRetainedLoadFailure(null);
    setPdfLoadState(INITIAL_PDF_LOAD_STATE);
    setSearchState(INITIAL_PDF_SEARCH_STATE);
    setOutlineState(INITIAL_PDF_OUTLINE_STATE);
    setSearchInput("");
    setPdfPassword("");
    setPdfReloadGeneration(0);
    setPasswordDraft("");
    setRotation(0);
    setRotationPending(false);
    setScreenReaderMode(false);
    // A different project has nothing on screen to preserve, so its first load
    // gets the explanatory startup panel again.
    setHasRendered(false);
  }, [projectId]);

  useEffect(() => {
    if (!pdfBytes) {
      if (!lastReadyDocumentRef.current) setViewerDocument(null);
      return;
    }
    // Compiled bytes are only a candidate when they carry the exact current
    // project/main-document/revision checkpoint. Retained last-good output is
    // managed separately after a successful viewer load; a delayed stale or
    // unverified candidate must never replace it.
    if (
      !compileCheckpoint ||
      !isCompileCheckpointCurrent(compileCheckpoint)
    ) {
      return;
    }
    const identity = checkpointIdentity(compileCheckpoint, pdfBytes);
    if (rejectedDocumentIdentitiesRef.current.has(identity)) return;
    setViewerDocument((current) => {
      if (
        current?.identity === identity &&
        current.bytes === pdfBytes
      ) {
        return current;
      }
      return {
        bytes: pdfBytes,
        checkpoint: compileCheckpoint,
        identity,
      };
    });
    setPdfLoadState({
      status: "loading",
      documentIdentity: identity,
      message: "Loading the latest compiled PDF…",
    });
    setSearchState(INITIAL_PDF_SEARCH_STATE);
    setOutlineState({
      status: "loading",
      items: [],
    });
    setPage(1);
    setNumPages(0);
    setPdfPassword("");
    setPasswordDraft("");
    setRetainedLoadFailure(null);
  }, [compileCheckpoint, pdfBytes]);

  const displayedCheckpoint = viewerDocument?.checkpoint ?? null;
  const pdfIsCurrent =
    viewerDocument !== null &&
    displayedCheckpoint !== null &&
    isCompileCheckpointCurrent(displayedCheckpoint);
  const pdfIsStale = viewerDocument !== null && !pdfIsCurrent;
  const syncTexAvailable =
    canUseSyncTexForCheckpoint(displayedCheckpoint);
  const staleSyncTexAvailable = pdfIsStale && syncTexAvailable;
  const displayedBytes = viewerDocument?.bytes ?? null;
  const currentRevisionExplanation = pdfIsStale
    ? displayedCheckpoint
      ? `Showing project revision ${displayedCheckpoint.projectRevision}. The active project is revision ${projectRevision}.`
      : "The displayed PDF has no verified compile identity for the active revision."
    : null;
  const startupStages = documentStartupStages({
    projectActive: projectId !== null,
    projectLoading,
    engineLoaded,
    languageReadiness,
    languageReason,
    analysisStatus,
    analysisReason,
    compileStatus: status,
    compilePhase: phase,
    compileCurrent: isCompileCheckpointCurrent(compileCheckpoint),
    compileFailureReason,
    hasPdfCandidate: pdfBytes !== null,
    viewerIdentity: viewerDocument?.identity ?? null,
    pdfCurrent: pdfIsCurrent,
    pdfLoadState,
    retainedLoadFailure,
  });
  // Only true fullscreen when the pane itself (not a descendant) is the fullscreen element.
  useEffect(() => {
    const onChange = () => {
      const fs = document.fullscreenElement === rootRef.current;
      setIsFs(fs);
      if (!fs) setFsToolbarHidden(false);
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else void rootRef.current?.requestFullscreen?.().catch(() => {});
  };

  // Two webview families report pinch-to-zoom differently; handle both and leave
  // ordinary two-finger scroll (no ctrlKey, no gesture events) alone.
  useEffect(() => {
    void displayedBytes;
    void tab;
    const el = scrollBoxRef.current;
    if (!el) return;
    return attachPreviewZoom(el, () => scaleRef.current, setScale);
  }, [displayedBytes, tab]);

  useEffect(() => {
    setPageInput(String(page));
  }, [page]);

  useEffect(() => {
    if (numPages <= 1 && layout === "double") setLayout("single");
  }, [layout, numPages]);

  useEffect(() => {
    if (!displayedBytes) {
      setNumPages(0);
      setPage(1);
    }
  }, [displayedBytes]);

  const jumpToPage = () => {
    const n = Number.parseInt(pageInput, 10);
    if (Number.isNaN(n) || n < 1 || n > numPages) {
      setPageInput(String(page));
      return;
    }
    if (n !== page) pdfRef.current?.gotoPage(n); // avoid snapping on an unchanged blur
  };

  const setClampedScale = useCallback((next: number) => {
    setScale(Math.min(MAX_PREVIEW_SCALE, Math.max(MIN_PREVIEW_SCALE, next)));
  }, []);

  const fitPreview = useCallback((mode: "width" | "height") => {
    const next = pdfRef.current?.getFitScale(mode);
    if (next != null) {
      setFitMode(mode);
      setClampedScale(next);
    }
  }, [setClampedScale]);

  // Open a project's preview fit to page height rather than flat 100%. Fires
  // once per project, the first time its PDF has pages to measure, so it
  // never overrides a zoom level the user picked mid-session.
  const autoFitProjectRef = useRef<string | null | undefined>(undefined);
  const userAdjustedZoomRef = useRef(false);
  useEffect(() => {
    if (autoFitProjectRef.current !== projectId) {
      autoFitProjectRef.current = undefined;
      userAdjustedZoomRef.current = false;
    }
  }, [projectId]);
  useEffect(() => {
    if (numPages <= 0 || autoFitProjectRef.current === projectId || userAdjustedZoomRef.current) return;
    autoFitProjectRef.current = projectId;
    // Re-check at fire time, not just when scheduling: the user can zoom
    // manually in the gap between this effect scheduling the frame and the
    // frame actually running, and cancelAnimationFrame on unmount doesn't
    // help there since the ref change alone doesn't retrigger this effect.
    const raf = requestAnimationFrame(() => {
      if (!userAdjustedZoomRef.current) fitPreview("height");
    });
    return () => cancelAnimationFrame(raf);
  }, [fitPreview, numPages, projectId]);

  // The auto-fit effect above is deferred a frame and can still be pending
  // when the user first touches zoom, so every UI-triggered zoom change goes
  // through this to cancel it - otherwise it silently overwrites whatever
  // zoom level the user just picked.
  const userZoom = useCallback((mutate: () => void) => {
    userAdjustedZoomRef.current = true;
    setFitMode(null);
    mutate();
  }, []);

  useEffect(() => {
    const element = scrollBoxRef.current;
    if (!element || !fitMode || !displayedBytes) return;
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
  }, [displayedBytes, fitMode, setClampedScale]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || tab !== "pdf") return;
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
          return;
        }
        if (outlineOpen) setOutlineOpen(false);
        return;
      }
      const target = event.target as HTMLElement | null;
      if (
        target?.matches("input, textarea, select") ||
        target?.isContentEditable
      ) {
        return;
      }
      if (
        pdfZoomShortcuts &&
        modifier &&
        (event.key === "+" || event.key === "=")
      ) {
        event.preventDefault();
        userZoom(() =>
          setScale((current) =>
            Math.min(MAX_PREVIEW_SCALE, current + 0.2),
          ),
        );
      } else if (pdfZoomShortcuts && modifier && event.key === "-") {
        event.preventDefault();
        userZoom(() =>
          setScale((current) =>
            Math.max(MIN_PREVIEW_SCALE, current - 0.2),
          ),
        );
      } else if (pdfZoomShortcuts && modifier && event.key === "0") {
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
  }, [outlineOpen, pdfZoomShortcuts, searchOpen, tab, userZoom]);

  const submitSavePdf = async () => {
    if (!projectId || !displayedBytes) return;
    setSaving(true);
    try {
      if (isImage) {
        const base = saveName.trim().replace(/\.(png|pdf)$/i, "") || "figure";
        const name = `${base}.png`;
        const { pdfPageToPng } = await import("@/lib/pdf-image");
        const dataUrl = await pdfPageToPng(displayedBytes, 1, 3);
        await saveFileBase64(projectId, name, dataUrl.slice(dataUrl.indexOf(",") + 1));
        await refreshTree();
        setSaveOpen(false);
        setSaveName("");
        toast.success("Image saved to the project.");
      } else {
        const raw = saveName.trim() || mainDoc.replace(/\.(?:tex|typ|md|markdown)$/i, "") || "document";
        const name = `${raw.replace(/\.pdf$/i, "")}.pdf`;
        await saveFileBase64(
          projectId,
          name,
          uint8ToBase64(displayedBytes),
        );
        await refreshTree();
        setSaveOpen(false);
        setSaveName("");
        toast.success("PDF saved to the project.");
      }
    } catch (e) {
      notifyError("save to project", e, "Couldn't save into the project.");
    } finally {
      setSaving(false);
    }
  };

  const exportDisplayedPreview = async () => {
    if (!displayedBytes || exporting) return;
    const baseName =
      (projectName || (isImage ? "figure" : "document"))
        .replace(/[^\w.-]+/g, "_")
        .replace(/^_+|_+$/g, "") ||
      (isImage ? "figure" : "document");
    setExporting(true);
    try {
      let exportBytes = displayedBytes;
      let extension = "pdf";
      let mimeType = "application/pdf";
      if (isImage) {
        const { pdfPageToPng } = await import("@/lib/pdf-image");
        const dataUrl = await pdfPageToPng(displayedBytes, 1, 3);
        exportBytes = Uint8Array.from(
          atob(dataUrl.slice(dataUrl.indexOf(",") + 1)),
          (character) => character.charCodeAt(0),
        );
        extension = "png";
        mimeType = "image/png";
      }
      const filename = `${baseName}.${extension}`;

      if (!isTauri()) {
        const objectUrl = URL.createObjectURL(
          new Blob([exportBytes.slice().buffer], { type: mimeType }),
        );
        try {
          const anchor = document.createElement("a");
          anchor.href = objectUrl;
          anchor.download = filename;
          anchor.rel = "noopener";
          anchor.click();
        } finally {
          // WebKit resolves the download asynchronously; defer revocation by
          // one task, but never leave the object URL alive beyond it.
          window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
        }
        return;
      }

      const destination = await pickSavePath({
        defaultPath: filename,
        filters: [
          {
            name: isImage ? "PNG image" : "PDF",
            extensions: [extension],
          },
        ],
      });
      if (!destination) return;
      await writeBytesFile(destination, uint8ToBase64(exportBytes));
      const fileName =
        destination.split(/[/\\]/).pop() || (isImage ? "image.png" : "document.pdf");
      toast.success(
        isImage ? `Image saved · ${fileName}` : `PDF saved · ${fileName}`,
        {
          label: "Show in folder",
          onClick: () => {
            void revealInDir(destination).catch(() => {
              toast.info(
                "File was saved, but Oleafly could not open its folder (permission denied). Check the location you chose in the save dialog.",
              );
            });
          },
        },
        true,
      );
    } catch (error) {
      const detail =
        error instanceof Error ? error.message : typeof error === "string" ? error : "";
      notifyError(
        "download preview",
        error,
        detail
          ? `Couldn't download the ${isImage ? "image" : "PDF"}: ${detail}`
          : `Couldn't download the ${isImage ? "image" : "PDF"}.`,
      );
    } finally {
      setExporting(false);
    }
  };

  const handlePdfLoadState = (next: PdfLoadState) => {
    const current = viewerDocument;
    if (!current || next.documentIdentity !== current.identity) return;
    setPdfLoadState(next);
    // Anything that settles the load also settles a rotation: a failed rotate
    // must not leave the button spinning forever.
    if (next.status !== "loading") setRotationPending(false);
    if (next.status === "ready") {
      setHasRendered(true);
      lastReadyDocumentRef.current = current;
      rejectedDocumentIdentitiesRef.current.delete(current.identity);
      if (current.checkpoint === compileCheckpoint) {
        setRetainedLoadFailure(null);
      }
      return;
    }
    if (
      next.status !== "invalid" &&
      next.status !== "unavailable" &&
      next.status !== "error" &&
      next.status !== "empty"
    ) {
      return;
    }
    const lastReady = lastReadyDocumentRef.current;
    if (!lastReady || lastReady.identity === current.identity) return;
    rejectedDocumentIdentitiesRef.current.add(current.identity);
    setRetainedLoadFailure(
      `${next.message ?? "The current PDF could not be loaded"} Showing the last successfully loaded PDF instead.`,
    );
    setViewerDocument(lastReady);
    setPdfPassword("");
    setPasswordDraft("");
  };

  const retryPdfLoad = () => {
    if (!viewerDocument) return;
    rejectedDocumentIdentitiesRef.current.delete(viewerDocument.identity);
    setPdfReloadGeneration((generation) => generation + 1);
    setPdfLoadState({
      status: "loading",
      documentIdentity: viewerDocument.identity,
      message: "Retrying PDF load…",
    });
  };

  const submitPdfPassword = () => {
    if (!passwordDraft) return;
    setPdfPassword(passwordDraft);
  };

  useEffect(() => {
    if (activeTourId === "workspace") return;
    if (status === "error" && !displayedBytes) setTab("logs");
    if (status === "success") setTab("pdf");
  }, [activeTourId, displayedBytes, status]);

  useEffect(() => {
    if (activeTourId === "workspace" && tourTabRef.current === null) {
      tourTabRef.current = tab;
      setTab("pdf");
    }
    if (activeTourId !== "workspace" && tourTabRef.current !== null) {
      setTab(tourTabRef.current);
      tourTabRef.current = null;
    }
  }, [activeTourId, tab]);

  const compiling = status === "compiling";
  const hasError =
    status === "error" ||
    status === "unavailable" ||
    errors.some((error) => error.kind === "error");
  const hasWarning = !hasError && errors.some((e) => e.kind === "warning");
  const severity: "error" | "warning" | "ok" = hasError ? "error" : hasWarning ? "warning" : "ok";

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
          Zoom in
        </DropdownMenuItem>
        <DropdownMenuItem disabled={scale <= MIN_PREVIEW_SCALE} onSelect={zoomOut}>
          Zoom out
        </DropdownMenuItem>
      </DropdownMenuGroup>
      <DropdownMenuSeparator />
      <DropdownMenuGroup>
        <DropdownMenuItem onSelect={() => userZoom(() => fitPreview("width"))}>
          Fit to width
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => userZoom(() => fitPreview("height"))}>
          Fit to height
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => userZoom(() => setScale(1))}>
          Reset to 100%
        </DropdownMenuItem>
      </DropdownMenuGroup>
      <DropdownMenuSeparator />
      <DropdownMenuGroup>
        {ZOOM_PRESETS.map((preset) => (
          <DropdownMenuItem
            key={preset}
            onSelect={() => userZoom(() => setClampedScale(preset))}
          >
            {Math.round(preset * 100)}%
          </DropdownMenuItem>
        ))}
      </DropdownMenuGroup>
    </>
  );

  // Grouped so the bar reads in a fixed order and the dividers fall out of
  // which groups actually have controls, rather than being placed by hand.
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
              aria-label="Page layout"
              className="flex shrink-0 items-center gap-0.5 rounded-md bg-muted/70 p-0.5"
            >
              {PAGE_LAYOUTS.map(({ value, label, icon: Icon }) => (
                <Tooltip key={value} label={label}>
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
                    aria-label={label}
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
                Page layout
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
                        {label}
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
            <Tooltip label="Previous page">
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                disabled={page <= 1}
                onClick={() => pdfRef.current?.gotoPage(page - (layout === "double" ? 2 : 1))}
                aria-label="Previous page"
              >
                <ChevronUp className="size-3.5" />
              </Button>
            </Tooltip>
            <div className="flex shrink-0 items-center gap-1 text-xs tabular-nums text-muted-foreground">
              <Input
                value={pageInput}
                onChange={(e) => setPageInput(e.target.value.replace(/[^0-9]/g, ""))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    jumpToPage();
                    (e.target as HTMLInputElement).blur();
                  }
                }}
                onBlur={jumpToPage}
                onFocus={(e) => e.target.select()}
                aria-label="Page number"
                className="h-6 w-7 rounded border border-input bg-background px-0.5 py-0 text-center text-[11px] leading-none text-foreground outline-none focus:border-primary"
              />
              <span>of {numPages}</span>
            </div>
            <Tooltip label="Next page">
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                disabled={page >= numPages}
                onClick={() => pdfRef.current?.gotoPage(page + (layout === "double" ? 2 : 1))}
                aria-label="Next page"
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
              {`Page ${page} of ${numPages}`}
            </DropdownMenuSubTrigger>
            <DropdownMenuPortal>
              <DropdownMenuSubContent className="min-w-44">
                <DropdownMenuItem
                  disabled={page <= 1}
                  onSelect={() => pdfRef.current?.gotoPage(page - (layout === "double" ? 2 : 1))}
                >
                  <ChevronUp className="size-4" />
                  Previous page
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={page >= numPages}
                  onSelect={() => pdfRef.current?.gotoPage(page + (layout === "double" ? 2 : 1))}
                >
                  <ChevronDown className="size-4" />
                  Next page
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuPortal>
          </DropdownMenuSub>
        ),
      },
    );
  }
  if (displayedBytes && !isImage) {
    viewGroup.push(
      iconControl(
        "outline",
        ListTree,
        "Document outline",
        () => setOutlineOpen((open) => !open),
        { active: outlineOpen },
      ),
      iconControl("search", Search, "Search PDF", () => {
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
        <Tooltip label="Zoom out">
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            disabled={scale <= MIN_PREVIEW_SCALE}
            onClick={zoomOut}
            aria-label="Zoom out"
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
              aria-label={`Zoom ${Math.round(scale * 100)} percent`}
              disabled={!displayedBytes}
            >
              {Math.round(scale * 100)}%
              <ChevronDown data-icon="inline-end" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="center" className="min-w-40">
            {zoomMenuItems()}
          </DropdownMenuContent>
        </DropdownMenu>
        <Tooltip label="Zoom in">
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            disabled={scale >= MAX_PREVIEW_SCALE}
            onClick={zoomIn}
            aria-label="Zoom in"
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
          {`Zoom · ${Math.round(scale * 100)}%`}
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
        <Tooltip label={isImage ? "Download image" : "Download displayed PDF"}>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            disabled={!displayedBytes || exporting}
            onClick={() => void exportDisplayedPreview()}
            aria-label={
              isImage
                ? "Download image"
                : pdfIsStale
                  ? "Download stale, non-current PDF"
                  : "Download PDF"
            }
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
          disabled={!displayedBytes || exporting}
          onSelect={() => void exportDisplayedPreview()}
        >
          <Download className="size-4" />
          {isImage ? "Download image" : "Download PDF"}
        </DropdownMenuItem>
      ),
    },
    iconControl(
      "save",
      Save,
      isImage ? "Save image to project" : "Save PDF to project",
      () => {
        if (isImage) {
          const base =
            (projectName || "figure").replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "") ||
            "figure";
          setSaveName(`${base}.png`);
        } else {
          setSaveName(`${mainDoc.replace(/\.(?:tex|typ|md|markdown)$/i, "") || "document"}.pdf`);
        }
        setSaveOpen(true);
      },
      { disabled: !displayedBytes },
    ),
  );
  inkGroup.push(
    iconControl(
      "invert",
      Contrast,
      "Invert PDF preview colors",
      () => setInverted(!inverted),
      {
        disabled: !displayedBytes,
        active: inverted,
        tooltip: inverted ? "Restore colors" : "Invert PDF preview colors",
      },
    ),
  );
  inkGroup.push(
    iconControl(
      "screen-reader",
      Accessibility,
      "Reader view",
      () => setScreenReaderMode(!screenReaderMode),
      {
        disabled: !displayedBytes || isImage,
        active: screenReaderMode,
        tooltip: screenReaderMode ? "Exit reader view" : "Reader view",
      },
    ),
  );
  if (!isImage) {
    inkGroup.push(
      iconControl(
        "rotate",
        RotateCw,
        "Rotate clockwise",
        () => {
          setRotationPending(true);
          setRotation((current) => ((current + 90) % 360) as PdfRotation);
        },
        {
          disabled: !displayedBytes,
          busy: rotationPending,
          tooltip: `Rotate PDF clockwise (90°). Currently ${rotation}°`,
        },
      ),
    );
  }
  if (!isFs) {
    windowGroup.push(
      iconControl(
        "open-window",
        SquareArrowOutUpRight,
        "Open preview in a new window",
        () => {
          if (!projectId) return;
          void openPreviewWindow(
            projectId,
            projectName,
            previewWindowState(
              status,
              lastAttemptIdentity,
              compileCheckpoint,
              compileFailureReason,
            ),
          );
        },
        { disabled: !projectId || !displayedBytes },
      ),
    );
  } else {
    windowGroup.push(
      iconControl("hide-toolbar", PanelTopClose, "Hide toolbar", () =>
        setFsToolbarHidden(true),
      ),
    );
  }
  viewGroup.push(
    iconControl(
      "fullscreen",
      isFs ? Minimize : Maximize,
      isFs ? "Exit fullscreen" : "Fullscreen preview",
      toggleFullscreen,
      { disabled: !displayedBytes },
    ),
  );

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

  const pdfVisibleCount = fitCount(pdfControls, pdfToolbarWidth);
  const pdfVisibleControls = pdfControls.slice(0, pdfVisibleCount);
  const pdfOverflowControls = pdfControls.slice(pdfVisibleCount);

  return (
    <div
      ref={rootRef}
      data-tour="project-preview"
      data-testid="preview-pane"
      data-preview-layout={layout}
      // Like data-preview-layout: the toolbar collapses its controls into an
      // overflow menu below a width threshold, so the pane reports the state
      // itself rather than making assertions depend on which form is rendered.
      data-preview-inverted={inverted ? "true" : "false"}
      className="relative flex h-full flex-col bg-background"
    >
      {isFs && fsToolbarHidden && (
        <Tooltip label="Show toolbar">
          <button type="button"
            onClick={() => setFsToolbarHidden(false)}
            aria-label="Show toolbar"
            className="absolute right-3 top-3 z-20 flex size-8 items-center justify-center rounded-full bg-black/40 text-white/80 backdrop-blur transition-colors hover:bg-black/60 hover:text-white"
          >
            <PanelTopOpen className="size-4" />
          </button>
        </Tooltip>
      )}
      <div
        className={cn(
          "flex min-h-10 shrink-0 flex-wrap items-center gap-1 border-b px-2 py-1 [&_button]:shrink-0",
          isFs && fsToolbarHidden && "hidden",
        )}
      >
        {viewMode === "pdf" && <SidebarCollapseToggle />}
        <div
          data-tour="project-compile-logs"
          className="flex items-center gap-1"
        >
          <button
            type="button"
            onClick={() => setTab(tab === "logs" ? "pdf" : "logs")}
            aria-label={tab === "logs" ? "Show PDF preview" : "Show compile logs"}
            aria-pressed={tab === "logs"}
            className={cn(
              "flex h-6 items-center gap-1.5 rounded-md px-2 text-xs font-medium",
              tab === "logs"
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <ScrollText className="size-3.5" />
            Logs
            {errors.length > 0 && (
              <span
                className={cn(
                  "rounded-full px-1.5 text-[10px] font-semibold text-white",
                  severity === "error" ? "bg-red-500" : "bg-amber-500"
                )}
              >
                {errors.length}
              </span>
            )}
          </button>

          {!compiling && status !== "idle" && (
            <span
              className={cn(
                "flex items-center gap-1 text-[10px] font-medium tabular-nums",
                severity === "error"
                  ? "text-red-500"
                  : severity === "warning"
                  ? "text-amber-500"
                  : "text-emerald-500"
              )}
              title={
                severity === "error"
                  ? "Compiled with errors"
                  : severity === "warning"
                  ? "Compiled with warnings"
                  : "Compiled successfully"
              }
              data-testid="compile-status"
              data-severity={severity}
            >
              {severity === "error" ? (
                <XCircle className="size-3.5" />
              ) : severity === "warning" ? (
                <AlertTriangle className="size-3.5" />
              ) : (
                <CheckCircle2 className="size-3.5" />
              )}
              {severity === "error" || compileTimeMs == null
                ? "Failed"
                : `${(compileTimeMs / 1000).toFixed(1)}s`}
            </span>
          )}

        </div>

        {tab === "logs" && hasError && (
          <div className="ml-auto flex items-center">
            <Button variant="ghostPrimary" size="xs" onClick={() => void askAiAboutCompileErrors()}>
              <Sparkles data-icon="inline-start" />
              Ask AI
            </Button>
          </div>
        )}

        {tab === "pdf" && (
          <div
            data-tour="project-preview-zoom"
            ref={pdfToolbarRef}
            className="ml-auto flex min-w-0 flex-1 items-center justify-end gap-0.5 overflow-hidden"
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
                    aria-label="More preview controls"
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
        )}
      </div>

      <div
        data-tour="project-preview-content"
        className="relative min-h-0 flex-1 overflow-hidden"
      >
        {tab === "logs" ? (
          <LogPane />
        ) : displayedBytes && viewerDocument ? (
          <div className="flex h-full min-h-0 flex-col bg-sidebar">
            <div className="relative min-h-0 flex-1 overflow-hidden">
              {/* Editing while a PDF is on screen is the normal case, so
                  staleness is a standing condition rather than news: a quiet
                  marker over the document that recompiles on click, not a
                  banner or a toolbar chip competing with the controls. */}
              {(pdfIsStale || retainedLoadFailure) && (
                // Tooltip wraps its child in a `relative` span, so the marker is
                // positioned by this wrapper rather than by the button itself.
                <div className="absolute bottom-3 right-3 z-30">
                <Tooltip
                  label={`The preview is stale against the editor changes. ${
                    retainedLoadFailure ??
                    currentRevisionExplanation ??
                    "This PDF does not represent the active project revision."
                  } ${
                    staleSyncTexAvailable
                      ? "SyncTeX uses the nearest unchanged line for edits."
                      : "SyncTeX requires a current compile."
                  } Click to recompile.`}
                  side="left"
                >
                  <button
                    type="button"
                    onClick={() => void recompile()}
                    data-testid="preview-stale-badge"
                    aria-label="Stale, non-current preview. Recompile."
                    className="flex h-7 items-center justify-center gap-1.5 rounded-full border border-neutral-300 bg-neutral-100 px-2.5 text-[11px] font-semibold text-neutral-700 shadow-sm transition-colors hover:bg-neutral-200 dark:border-neutral-700 dark:bg-[#181818] dark:text-neutral-300 dark:hover:bg-[#222222]"
                  >
                    <span
                      aria-hidden="true"
                      className="size-1.5 rounded-full bg-amber-500 dark:bg-amber-400"
                    />
                    Stale
                  </button>
                </Tooltip>
                </div>
              )}
              {/* Kept mounted so closing animates too, not just opening. The
                  clipped parent hides it off-canvas and `inert` keeps a closed
                  panel out of the tab order and the accessibility tree. */}
              {(
                <aside
                  id="pdf-outline-panel"
                  aria-label="PDF document outline"
                  inert={!outlineOpen}
                  className={cn(
                    "absolute inset-y-2 left-2 z-30 flex w-[min(19rem,calc(100%-1rem))] flex-col overflow-hidden rounded-lg border bg-popover/80 text-popover-foreground shadow-xl backdrop-blur-xl supports-[not(backdrop-filter:blur(0))]:bg-popover",
                    "transition-transform duration-200 ease-out motion-reduce:transition-none",
                    outlineOpen
                      ? "translate-x-0"
                      : "-translate-x-[calc(100%_+_1rem)]",
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
                      <PdfOutlineItems
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

              {searchOpen && (
                <search
                  id="pdf-search-panel"
                  aria-label="Search this PDF"
                  className="absolute right-2 top-2 z-30 flex max-w-[calc(100%-1rem)] items-center gap-1 rounded-lg border bg-popover p-1.5 text-popover-foreground shadow-xl"
                >
                  <Search className="ml-1 size-3.5 shrink-0 text-muted-foreground" />
                  <Input
                    ref={searchInputRef}
                    value={searchInput}
                    onChange={(event) =>
                      setSearchInput(event.target.value)
                    }
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
                data-pdf-scroll-root
                aria-label="PDF continuous scroll area"
                className="h-full overflow-auto bg-sidebar focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                style={
                  inverted && !screenReaderMode
                    ? { filter: "invert(1) hue-rotate(180deg)" }
                    : undefined
                }
              >
                <ErrorBoundary
                  resetKey={`${viewerDocument.identity}:${pdfReloadGeneration}`}
                  fallback={
                    <PdfStateMessage
                      kind="error"
                      title="The PDF preview crashed"
                      detail="Recompile the current revision or retry the viewer."
                      onRetry={retryPdfLoad}
                    />
                  }
                >
                  <PdfViewer
                    // Deliberately NOT keyed on the document identity. That
                    // remounted the whole viewer on every recompile, tearing the
                    // rendered canvases out before a replacement existed - the
                    // blank flash between builds. The viewer already reloads on
                    // a `documentIdentity` change and now swaps its pages only
                    // once the new layout is ready. `pdfReloadGeneration` stays:
                    // retry-after-failure does want a clean instance.
                    key={pdfReloadGeneration}
                    ref={pdfRef}
                    data={displayedBytes}
                    documentIdentity={viewerDocument.identity}
                    password={pdfPassword || undefined}
                    rotation={rotation}
                    scale={scale}
                    layout={layout}
                    expectText={!isImage}
                    screenReaderMode={screenReaderMode && !isImage}
                    searchQuery={searchOpen ? deferredSearch : ""}
                    onLoadStateChange={handlePdfLoadState}
                    onSearchStateChange={setSearchState}
                    onOutlineStateChange={setOutlineState}
                    onInverse={
                      syncTexAvailable
                        ? (pageNumber, clickX, clickY, word) =>
                            void inverseFromClick(
                              pageNumber,
                              clickX,
                              clickY,
                              word,
                              displayedCheckpoint,
                            )
                        : undefined
                    }
                    onPageChange={(current, total) => {
                      setPage(current);
                      setNumPages(total);
                      usePdfViewStore.getState().setPage(current);
                    }}
                  />
                </ErrorBoundary>
              </section>

              {pdfLoadState.documentIdentity ===
                viewerDocument.identity &&
                pdfLoadState.status !== "ready" &&
                pdfLoadState.status !== "idle" &&
                // Once a page has been rendered, a reload (recompile, rotate,
                // password retry) keeps that page on screen. Covering it with
                // the startup panel and uncovering it a moment later is the
                // flicker; failures still take over, because then there is
                // something the user has to act on.
                (!hasRendered || pdfLoadState.status !== "loading") && (
                  <div className="absolute inset-0 z-20 flex items-center justify-center bg-sidebar/90 p-6 backdrop-blur-[1px]">
                    {pdfLoadState.status === "password_required" ? (
                      <form
                        className="w-full max-w-xs space-y-3 text-center"
                        onSubmit={(event) => {
                          event.preventDefault();
                          submitPdfPassword();
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
                    ) : pdfLoadState.status === "loading" ? (
                      <DocumentStartupProgress stages={startupStages} />
                    ) : (
                      <PdfStateMessage
                        kind="error"
                        title={
                          pdfLoadState.status === "invalid"
                            ? "Invalid PDF"
                            : pdfLoadState.status === "empty"
                              ? "Empty PDF"
                              : pdfLoadState.status === "unavailable"
                                ? "PDF viewer unavailable"
                                : "PDF load failed"
                        }
                        detail={
                          pdfLoadState.message ??
                          "The PDF could not be loaded."
                        }
                        onRetry={retryPdfLoad}
                      />
                    )}
                  </div>
                )}
            </div>
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center bg-sidebar px-6">
            {status === "error" || status === "unavailable" ? (
              <div className="space-y-3 text-center text-muted-foreground">
                <FileText className="mx-auto size-10 opacity-30" />
                <p className="max-w-xs text-sm" role="alert">
                  {compileFailureReason ??
                    (status === "unavailable"
                      ? "PDF compilation is currently unavailable."
                      : "Compile failed. Open the Logs tab to see what went wrong.")}
                </p>
                <Button size="sm" onClick={() => void recompile()}>
                  Retry compile
                </Button>
              </div>
            ) : (
              <DocumentStartupProgress
                stages={startupStages}
              />
            )}
          </div>
        )}
        <div className="sr-only" aria-live="polite">
          {pdfIsStale
            ? `Stale, non-current PDF. ${currentRevisionExplanation ?? ""}`
            : numPages > 0
              ? `PDF page ${page} of ${numPages}.`
              : ""}
          {searchState.status === "success" && searchInput.trim()
            ? ` Search result ${searchState.current} of ${searchState.total}.`
            : ""}
        </div>
      </div>

      {saveOpen && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
          <button type="button" aria-label="Close save dialog" className="absolute inset-0" onMouseDown={onSaveBackdropMouseDown} />
          <div
            ref={saveDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="save-preview-title"
            tabIndex={-1}
            className="relative w-full max-w-sm rounded-xl border bg-popover p-5 text-popover-foreground shadow-2xl"
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 id="save-preview-title" className="text-sm font-semibold">{isImage ? "Save image to project" : "Save PDF to project"}</h2>
              <button
                type="button"
                onClick={closeSave}
                aria-label="Close save dialog"
                className="text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X className="size-4" />
              </button>
            </div>
            <p className="mb-3 text-xs text-muted-foreground">
              {pdfIsStale
                ? "Saves the displayed stale PDF into the project tree. It does not represent the active revision."
                : "Saves the displayed PDF into the project tree (committed via Git)."}
            </p>
            <div className="flex items-center gap-2">
              <Input
                data-modal-initial-focus
                aria-label="Project save name"
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !saving) void submitSavePdf(); }}
                placeholder="document.pdf"
                className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm outline-none"
              />
              <Button
                onClick={() => void submitSavePdf()}
                disabled={saving || !displayedBytes}
              >
                {saving ? "Saving…" : "Save"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

type OutlineItem = PdfOutlineState["items"][number];

function PdfOutlineItems({
  items,
  onActivate,
  depth = 0,
}: {
  items: OutlineItem[];
  onActivate: (id: string) => void;
  depth?: number;
}) {
  return (
    <ul className="space-y-0.5">
      {items.map((item) => (
        <li key={item.id}>
          <button
            type="button"
            disabled={Boolean(item.disabledReason)}
            title={item.disabledReason}
            onClick={() => onActivate(item.id)}
            className="flex min-h-8 w-full items-center gap-2 rounded px-2 py-1 text-left text-xs hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
            style={{ paddingInlineStart: `${8 + depth * 14}px` }}
          >
            <span className="min-w-0 flex-1 truncate">
              {item.title}
            </span>
            {item.external && (
              <SquareArrowOutUpRight
                className="size-3 shrink-0 text-muted-foreground"
                aria-label="External link"
              />
            )}
          </button>
          {item.children.length > 0 && (
            <PdfOutlineItems
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

function PdfStateMessage({
  kind,
  title,
  detail,
  onRetry,
}: {
  kind: "loading" | "error";
  title: string;
  detail: string;
  onRetry?: () => void;
}) {
  return (
    <div
      className="mx-auto flex max-w-sm flex-col items-center gap-3 text-center"
      role={kind === "error" ? "alert" : "status"}
      aria-live={kind === "error" ? "assertive" : "polite"}
    >
      {kind === "loading" ? (
        <Loader2 className="size-7 animate-spin text-muted-foreground motion-reduce:animate-none" />
      ) : (
        <AlertTriangle className="size-7 text-destructive" />
      )}
      <div>
        <h2 className="text-sm font-semibold text-foreground">
          {title}
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          {detail}
        </p>
      </div>
      {onRetry && (
        <Button size="sm" onClick={onRetry}>
          Retry viewer
        </Button>
      )}
    </div>
  );
}

const STARTUP_STATUS_LABEL: Record<StartupStageStatus, string> = {
  complete: "done",
  running: "running",
  pending: "queued",
  skipped: "skipped",
  error: "failed",
};

const STARTUP_STATUS_TEXT: Record<StartupStageStatus, string> = {
  complete: "text-emerald-500",
  running: "text-blue-500 dark:text-blue-400",
  pending: "text-muted-foreground/70",
  skipped: "text-muted-foreground/70",
  error: "text-destructive",
};

const STARTUP_STATUS_FILL: Record<StartupStageStatus, string> = {
  complete: "bg-emerald-500",
  running: "bg-blue-500",
  pending: "bg-muted-foreground/25",
  skipped: "bg-muted-foreground/30",
  error: "bg-destructive",
};

function StartupStageIcon({
  status,
  compact,
}: {
  status: StartupStageStatus;
  compact: boolean;
}) {
  const size = compact ? "size-3.5" : "size-4";
  if (status === "complete") {
    return <CheckCircle2 className={cn(size, "text-emerald-500")} />;
  }
  if (status === "running") {
    return (
      <Loader2
        className={cn(
          size,
          "animate-spin text-blue-500 motion-reduce:animate-none dark:text-blue-400",
        )}
      />
    );
  }
  if (status === "error") {
    return <XCircle className={cn(size, "text-destructive")} />;
  }
  if (status === "skipped") {
    return <Minus className={cn(size, "text-muted-foreground/60")} />;
  }
  // Queued stages get a resting dot rather than a number: the list order
  // already says which one is next.
  return (
    <span
      className={cn(
        "block rounded-full bg-muted-foreground/40",
        compact ? "size-1" : "size-1.5",
      )}
    />
  );
}

function DocumentStartupProgress({
  stages,
  compact = false,
  onCompile,
}: {
  stages: DocumentStartupStage[];
  compact?: boolean;
  onCompile?: () => void;
}) {
  const activeStage = [...stages]
    .reverse()
    .find((stage) => stage.status === "running");
  const failedStage = stages.find((stage) => stage.status === "error");
  const waitingStage = stages.find((stage) => stage.status === "pending");
  const currentStage = activeStage ?? failedStage ?? waitingStage;
  const completedCount = stages.filter(
    (stage) =>
      stage.status === "complete" || stage.status === "skipped",
  ).length;
  const runningCount = stages.filter(
    (stage) => stage.status === "running",
  ).length;
  const queuedCount = stages.filter(
    (stage) => stage.status === "pending",
  ).length;
  const failedCount = stages.filter(
    (stage) => stage.status === "error",
  ).length;
  const meta = [
    runningCount > 0 ? `${runningCount} running` : null,
    queuedCount > 0 ? `${queuedCount} queued` : null,
    failedCount > 0 ? `${failedCount} failed` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div
      className={cn(
        "w-full text-left text-foreground",
        compact
          ? "max-w-[22rem] rounded-lg bg-background/75 px-3 py-2.5 shadow-sm ring-1 ring-border/40 backdrop-blur-sm"
          : "max-w-lg",
      )}
      role="status"
      aria-live="polite"
      aria-label={`Document startup: ${completedCount} of ${stages.length} stages complete or skipped`}
    >
      <div className="flex items-center gap-2.5">
        <FileText
          className={cn(
            "shrink-0 text-muted-foreground",
            compact ? "size-3.5" : "size-4",
          )}
        />
        <h2
          className={cn(
            "min-w-0 truncate font-semibold",
            compact ? "text-xs" : "text-sm",
            activeStage && "ai-shimmer",
          )}
        >
          {activeStage
            ? activeStage.label
            : failedStage
              ? "Startup needs attention"
              : completedCount === stages.length
                ? "PDF preview ready"
                : "Preparing PDF preview"}
        </h2>
        {activeStage && (
          <span
            className="size-1.5 shrink-0 animate-pulse rounded-full bg-blue-500 motion-reduce:animate-none"
            aria-hidden="true"
          />
        )}
        <span
          className={cn(
            "ml-auto shrink-0 font-mono tabular-nums text-muted-foreground",
            compact ? "text-[9px]" : "text-[10px]",
          )}
        >
          {completedCount}/{stages.length} done
        </span>
      </div>

      {/* One segment per stage, so the bar reads as the same checklist the
          rows spell out rather than an opaque percentage. */}
      <div className={cn("flex gap-1", compact ? "mt-2" : "mt-2.5")} aria-hidden="true">
        {stages.map((stage) => (
          <span
            key={stage.id}
            className={cn(
              "h-1 flex-1 rounded-full transition-colors duration-500",
              STARTUP_STATUS_FILL[stage.status],
              stage.status === "running" &&
                "animate-pulse motion-reduce:animate-none",
            )}
          />
        ))}
      </div>

      {meta && (
        <p
          className={cn(
            "mt-1.5 font-mono text-muted-foreground",
            compact ? "text-[9px]" : "text-[10px]",
          )}
        >
          {meta}
        </p>
      )}

      <ol className={cn("divide-y divide-border/50", compact ? "mt-2" : "mt-3")}>
        {stages.map((stage) => (
          <li
            key={stage.id}
            className={cn(
              "flex min-w-0 items-center gap-3",
              compact ? "py-1.5" : "py-2.5",
            )}
            aria-current={stage.status === "running" ? "step" : undefined}
          >
            <span
              className={cn(
                "flex shrink-0 items-center justify-center",
                compact ? "size-4" : "size-5",
              )}
            >
              <StartupStageIcon status={stage.status} compact={compact} />
            </span>
            <span className="min-w-0 flex-1">
              <span
                className={cn(
                  "block truncate font-medium",
                  compact ? "text-[11px]" : "text-xs",
                  (stage.status === "pending" || stage.status === "skipped") &&
                    "text-muted-foreground",
                  stage.status === "error" && "text-destructive",
                )}
              >
                {stage.label}
              </span>
              {!compact && (
                <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">
                  {stage.detail}
                </span>
              )}
            </span>
            <span
              className={cn(
                "shrink-0 font-mono uppercase tracking-wide",
                compact ? "text-[9px]" : "text-[10px]",
                STARTUP_STATUS_TEXT[stage.status],
              )}
            >
              {STARTUP_STATUS_LABEL[stage.status]}
            </span>
          </li>
        ))}
      </ol>

      {currentStage && compact && (
        <p className="mt-1 truncate text-[10px] text-muted-foreground" title={currentStage.detail}>
          {currentStage.detail}
        </p>
      )}

      {onCompile && (
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border/60 pt-3">
          <Button size="sm" onClick={onCompile}>
            <Play className="size-3.5" />
            Compile now
          </Button>
          <span className="text-[10px] text-muted-foreground">
            or press{" "}
            <kbd className="rounded bg-muted px-1.5 py-0.5 font-medium">
              {shortcut("⌘↵")}
            </kbd>
          </span>
        </div>
      )}
    </div>
  );
}
