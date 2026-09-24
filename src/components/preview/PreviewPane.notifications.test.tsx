// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useCompileStore } from "@/store/compile";
import { useFilesStore } from "@/store/files";
import { useProjectAnalysisStore } from "@/store/project-analysis";
import { useTourStore } from "@/store/tours";
import { useEnginePickerStore } from "@/store/engine-picker";
import { LATEX_ENGINE } from "@/lib/document-engine";
import { importCompatFinding } from "@oleafly/latex";
import enPreview from "@/i18n/locales/en/preview.json" with { type: "json" };

const mocks = vi.hoisted(() => {
  let nextId = 0;
  return {
    tauri: { enabled: false },
    toast: {
      success: vi.fn((..._args: unknown[]) => ++nextId),
      successUnique: vi.fn((..._args: unknown[]) => ++nextId),
      error: vi.fn(() => ++nextId),
      info: vi.fn(() => ++nextId),
      dismiss: vi.fn(),
    },
    notifyError: vi.fn(),
    logError: vi.fn(),
    pickSavePath: vi.fn(),
    writeBytesFile: vi.fn(),
    saveFileBase64: vi.fn(),
    revealInDir: vi.fn(),
  };
});

vi.mock("@/components/pdf/PdfViewer", async () => {
  const react = await import("react");
  interface StubProps {
    documentIdentity: string;
    onPageChange?: (page: number, total: number) => void;
    onLoadStateChange?: (state: Record<string, unknown>) => void;
    onOutlineStateChange?: (state: Record<string, unknown>) => void;
  }
  const PdfViewer = react.forwardRef<unknown, StubProps>((props, ref) => {
    react.useImperativeHandle(
      ref,
      () => ({
        getFitScale: () => 1.5,
        activateOutlineItem: vi.fn(),
        gotoPage: vi.fn(),
        scrollToPage: vi.fn(),
        findNext: vi.fn(),
        findPrevious: vi.fn(),
      }),
      [],
    );
    const announce = react.useRef(props);
    announce.current = props;
    react.useEffect(() => {
      announce.current.onPageChange?.(1, 1);
      announce.current.onLoadStateChange?.({
        status: "ready",
        documentIdentity: props.documentIdentity,
      });
      announce.current.onOutlineStateChange?.({ status: "ready", items: [] });
    }, [props.documentIdentity]);
    return <div data-testid="mock-pdf-viewer" />;
  });
  return { PdfViewer };
});
vi.mock("@/components/editor/LogPane", () => ({
  LogPane: () => <div data-testid="mock-log-pane" />,
}));
vi.mock("@/features/synctex", () => ({
  canUseSyncTexForCheckpoint: vi.fn(() => false),
  inverseFromClick: vi.fn(),
}));
vi.mock("@/features/ask-ai-compile-errors", () => ({
  askAiAboutCompileErrors: vi.fn(),
}));
vi.mock("@/lib/preview-window", () => ({ openPreviewWindow: vi.fn() }));
vi.mock("@/components/ui/toolbar-overflow", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAvailableWidth: () => ({
    containerRef: () => {},
    availableWidth: Number.POSITIVE_INFINITY,
  }),
}));
vi.mock("@tauri-apps/api/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tauri-apps/api/core")>()),
  isTauri: () => mocks.tauri.enabled,
}));
vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  revealInDir: mocks.revealInDir,
  saveFileBase64: mocks.saveFileBase64,
  writeBytesFile: mocks.writeBytesFile,
}));
vi.mock("@/lib/native-file-dialog", () => ({ pickSavePath: mocks.pickSavePath }));
vi.mock("@/lib/toast", () => ({ toast: mocks.toast, notifyError: mocks.notifyError }));
vi.mock("@/lib/log", () => ({ logError: mocks.logError }));

import { PreviewPane } from "./PreviewPane";
import { sessionZoomByProject } from "./preview-zoom";

const PROJECT = "notifications-fixture";
const DESTINATION = "/Users/me/Downloads/Notifications_fixture.pdf";
const FAILURE_REASON = "Compilation did not produce a valid current PDF.";

function openProject(refreshTree: () => Promise<void>) {
  useProjectAnalysisStore.getState().activateProject({
    projectId: PROJECT,
    projectRevision: 2,
    languageServiceGeneration: 0,
  });
  useFilesStore.setState({
    projectId: PROJECT,
    projectName: "Notifications fixture",
    projectKind: "",
    mainDoc: "main.tex",
    engineLoaded: true,
    refreshTree,
  } as unknown as ReturnType<typeof useFilesStore.getState>);
  useCompileStore.setState({
    status: "success",
    phase: "idle",
    log: "",
    errors: [],
    failureReason: null,
    compileTimeMs: 120,
    lastAttemptIdentity: null,
    pdfBytes: new Uint8Array([1, 2, 3]),
    lastCompileCheckpoint: {
      version: 1,
      projectId: PROJECT,
      mainDocument: "main.tex",
      projectRevision: 2,
      requestGeneration: 1,
      outputKind: "standard",
      producerId: "test",
      outputRevision: 1,
      outputId: `pdf-v1:3:${PROJECT}`,
      completedAt: 1,
    },
    recompile: vi.fn().mockResolvedValue(undefined),
  } as unknown as ReturnType<typeof useCompileStore.getState>);
}

async function renderPane(
  refreshTree: () => Promise<void> = vi.fn().mockResolvedValue(undefined),
) {
  openProject(refreshTree);
  render(<PreviewPane />);
  await screen.findByTestId("mock-pdf-viewer");
}

async function download(user: ReturnType<typeof userEvent.setup>) {
  const button = screen.getByRole("button", { name: enPreview.actions.downloadPdf });
  await user.click(button);
  await waitFor(() => expect(button).not.toBeDisabled());
}

function savedToast(call: number) {
  const [key, message, action, sticky] = mocks.toast.successUnique.mock.calls[call] as [
    string,
    string,
    { label: string; onClick: () => void } | undefined,
    boolean | undefined,
  ];
  return { key, message, action, sticky };
}

async function saveToProject(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByLabelText(enPreview.actions.savePdf));
  await screen.findByLabelText(enPreview.save.nameLabel);
  await user.click(screen.getByRole("button", { name: "Save" }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.tauri.enabled = true;
  sessionZoomByProject.clear();
  useTourStore.setState({ activeTourId: null });
  mocks.pickSavePath.mockResolvedValue(DESTINATION);
  mocks.writeBytesFile.mockResolvedValue(undefined);
  mocks.saveFileBase64.mockResolvedValue(undefined);
  mocks.revealInDir.mockResolvedValue(undefined);
});

describe("PreviewPane download notice", () => {
  it("confirms a download once with a folder action", async () => {
    await renderPane();
    const user = userEvent.setup();

    await download(user);

    expect(mocks.writeBytesFile).toHaveBeenCalledOnce();
    expect(mocks.toast.successUnique).toHaveBeenCalledOnce();
    expect(mocks.toast.success).not.toHaveBeenCalled();
    const { message, action, sticky } = savedToast(0);
    expect(message).toBe(enPreview.download.pdfSaved.replace("{{name}}", "Notifications_fixture.pdf"));
    expect(action?.label).toBe(enPreview.download.showInFolder);
    expect(sticky).toBeUndefined();

    action?.onClick();
    expect(mocks.revealInDir).toHaveBeenCalledWith(DESTINATION);
  });

  it("replaces the previous download notice instead of stacking a second one", async () => {
    await renderPane();
    const user = userEvent.setup();

    await download(user);
    await download(user);

    expect(mocks.toast.successUnique).toHaveBeenCalledTimes(2);
    expect(savedToast(1).key).toBe(savedToast(0).key);
    expect(mocks.toast.success).not.toHaveBeenCalled();
    expect(mocks.toast.dismiss).not.toHaveBeenCalled();
  });

  it("stays quiet when the save dialog is cancelled", async () => {
    mocks.pickSavePath.mockResolvedValue(null);
    await renderPane();
    const user = userEvent.setup();

    await download(user);

    expect(mocks.writeBytesFile).not.toHaveBeenCalled();
    expect(mocks.toast.successUnique).not.toHaveBeenCalled();
    expect(mocks.notifyError).not.toHaveBeenCalled();
  });

  it("logs why the folder could not open and says so in one notice", async () => {
    const failure = new Error("reveal failed");
    mocks.revealInDir.mockRejectedValue(failure);
    await renderPane();
    const user = userEvent.setup();

    await download(user);
    savedToast(0).action?.onClick();

    await waitFor(() =>
      expect(mocks.toast.info).toHaveBeenCalledWith(enPreview.download.folderUnavailable),
    );
    expect(mocks.toast.info).toHaveBeenCalledOnce();
    expect(mocks.logError).toHaveBeenCalledWith("reveal downloaded preview", failure);
  });
});

describe("PreviewPane save to project", () => {
  it("confirms a saved PDF even when the file tree cannot refresh", async () => {
    const refreshFailure = new Error("list failed");
    const refreshTree = vi.fn().mockRejectedValue(refreshFailure);
    await renderPane(refreshTree);
    const user = userEvent.setup();

    await saveToProject(user);

    await waitFor(() =>
      expect(mocks.toast.success).toHaveBeenCalledWith(enPreview.save.pdfSaved),
    );
    expect(refreshTree).toHaveBeenCalledOnce();
    expect(mocks.logError).toHaveBeenCalledWith(expect.any(String), refreshFailure);
    expect(mocks.notifyError).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.queryByLabelText(enPreview.save.nameLabel)).not.toBeInTheDocument(),
    );
  });

  it("reports a failed save once and keeps the dialog open", async () => {
    const failure = new Error("outside the project");
    mocks.saveFileBase64.mockRejectedValue(failure);
    await renderPane();
    const user = userEvent.setup();

    await saveToProject(user);

    await waitFor(() => expect(mocks.notifyError).toHaveBeenCalledOnce());
    expect(mocks.notifyError).toHaveBeenCalledWith("save to project", failure, enPreview.save.failed);
    expect(mocks.toast.success).not.toHaveBeenCalled();
    expect(screen.getByLabelText(enPreview.save.nameLabel)).toBeInTheDocument();
  });
});

describe("PreviewPane failed-compile panel", () => {
  function failWithOffer(engineId: string) {
    openProject(vi.fn().mockResolvedValue(undefined));
    useFilesStore.setState({
      engine: { ...LATEX_ENGINE, id: engineId },
    } as unknown as ReturnType<typeof useFilesStore.getState>);
    useEnginePickerStore.setState({ open: false, source: "manual", findings: [] });
    useCompileStore.setState({
      status: "error",
      pdfBytes: null,
      lastCompileCheckpoint: null,
      failureReason: FAILURE_REASON,
      offer: { kind: "engine-gap", projectId: PROJECT, findings: [importCompatFinding("minted")] },
    } as unknown as ReturnType<typeof useCompileStore.getState>);
  }

  it("offers the engine choice an automatic compile found in the log view", async () => {
    failWithOffer("latex");
    render(<PreviewPane />);
    const user = userEvent.setup();

    await user.click(await screen.findByTestId("log-compile-offer"));

    expect(screen.getByTestId("log-compile-offer")).toHaveTextContent(enPreview.actions.chooseEngine);
    const picker = useEnginePickerStore.getState();
    expect(picker.open).toBe(true);
    expect(picker.source).toBe("compile-failure");
    expect(picker.findings.map((finding) => finding.id)).toEqual(["minted"]);
    expect(mocks.toast.info).not.toHaveBeenCalled();
  });

  it("hides an engine choice that no longer applies to the current engine", async () => {
    failWithOffer("latexmk");
    render(<PreviewPane />);

    await screen.findByTestId("mock-log-pane");
    expect(screen.queryByTestId("log-compile-offer")).toBeNull();
  });
});
