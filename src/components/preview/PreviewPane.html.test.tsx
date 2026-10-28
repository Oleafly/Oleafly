// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  openCompiledHtml: vi.fn(async (_projectId: string) => {}),
}));

vi.mock("@/components/pdf/PdfViewer", () => ({ PdfViewer: () => null }));
vi.mock("@/components/editor/LogPane", () => ({ LogPane: () => null }));
vi.mock("@/features/synctex", () => ({
  canUseSyncTexForCheckpoint: vi.fn(() => false),
  inverseFromClick: vi.fn(),
}));
vi.mock("@/features/ask-ai-compile-errors", () => ({ askAiAboutCompileErrors: vi.fn() }));
vi.mock("@/lib/preview-window", () => ({ openPreviewWindow: vi.fn() }));
vi.mock("@/lib/notebook-commands", () => ({ openCompiledHtml: mocks.openCompiledHtml }));
vi.mock("@/components/ui/toolbar-overflow", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAvailableWidth: () => ({
    containerRef: () => {},
    availableWidth: Number.POSITIVE_INFINITY,
  }),
}));

import enErrors from "@/i18n/locales/en/errors.json" with { type: "json" };
import enPreview from "@/i18n/locales/en/preview.json" with { type: "json" };
import { APP_ERROR_PREFIX } from "@/lib/app-error";
import { LATEX_ENGINE } from "@/lib/document-engine";
import { formatTime } from "@/lib/intl";
import type { DocumentEngineDescriptor } from "@/lib/tauri";
import { useCompileStore, type CompiledHtmlOutput } from "@/store/compile";
import { useFilesStore } from "@/store/files";
import { useToastStore } from "@/store/toast";
import { PreviewPane } from "./PreviewPane";

const copy = enPreview.html;
const BUILT_AT = Date.UTC(2026, 9, 24, 14, 5);

function quarto(output: "html" | "pdf"): DocumentEngineDescriptor {
  return {
    ...LATEX_ENGINE,
    id: "quarto",
    label: "Quarto",
    source_format: "markdown",
    main_document: "report.qmd",
    notebook_output: output,
  } as unknown as DocumentEngineDescriptor;
}

const recompile = vi.fn();

function show({
  engine = quarto("html"),
  status = "success",
  htmlOutput = { projectId: "p1", path: "/p1/.oleafly/build/report.html", builtAt: BUILT_AT },
}: {
  engine?: DocumentEngineDescriptor;
  status?: string;
  htmlOutput?: CompiledHtmlOutput | null;
} = {}) {
  useFilesStore.setState({
    projectId: "p1",
    projectName: "Report",
    projectKind: "",
    manifestHome: "library",
    mainDoc: "report.qmd",
    tree: [{ path: "report.qmd", is_dir: false }],
    engine,
    engineLoaded: true,
  } as unknown as ReturnType<typeof useFilesStore.getState>);
  useCompileStore.setState({
    status,
    phase: "idle",
    log: "",
    errors: [],
    failureReason: null,
    pdfBytes: null,
    lastCompileCheckpoint: null,
    lastAttemptIdentity: null,
    htmlOutput,
    recompile,
  } as unknown as ReturnType<typeof useCompileStore.getState>);
  render(<PreviewPane />);
}

beforeEach(() => {
  vi.clearAllMocks();
  useCompileStore.getState().reset();
  useToastStore.getState().reset();
});

describe("preview of a document built as a web page", () => {
  it("says when it was built and opens it in the browser in one click", async () => {
    show();
    const panel = await screen.findByTestId("html-output-panel");
    expect(panel).toHaveTextContent(copy.builtTitle);
    expect(panel).toHaveTextContent(copy.builtDetail.replace("{{time}}", formatTime(BUILT_AT)));
    await userEvent.setup().click(screen.getByRole("button", { name: copy.open }));
    expect(mocks.openCompiledHtml).toHaveBeenCalledExactlyOnceWith("p1");
    expect(screen.getByRole("button", { name: enPreview.actions.downloadPdf })).toBeDisabled();
  });

  it("tells the user once when the page cannot open", async () => {
    mocks.openCompiledHtml.mockRejectedValueOnce(
      `${APP_ERROR_PREFIX}${JSON.stringify({ code: "notebook.no_html_output", params: {}, detail: null })}`,
    );
    show();
    await userEvent.setup().click(await screen.findByRole("button", { name: copy.open }));
    await waitFor(() =>
      expect(useToastStore.getState().toasts).toEqual([
        expect.objectContaining({ key: "open-html:p1", kind: "error", message: enErrors.notebook.no_html_output }),
      ]),
    );
    expect(screen.getByRole("button", { name: copy.open })).toBeEnabled();
  });

  it("keeps the last page while a new build runs", async () => {
    show({ status: "compiling" });
    expect(await screen.findByTestId("html-output-panel")).toHaveTextContent(copy.builtTitle);
  });

  it("asks for a compile before the first build and shows the build as it runs", async () => {
    show({ status: "idle", htmlOutput: null });
    expect(await screen.findByTestId("html-output-panel")).toHaveTextContent(copy.pendingTitle);
    await userEvent.setup().click(screen.getByRole("button", { name: copy.compile }));
    expect(recompile).toHaveBeenCalledOnce();
    useCompileStore.setState({ status: "compiling" });
    expect(await screen.findByText(copy.building)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: copy.compile })).not.toBeInTheDocument();
  });

  it("ignores a page from another project", () => {
    show({
      engine: quarto("pdf"),
      status: "idle",
      htmlOutput: { projectId: "other", path: "/other/index.html", builtAt: BUILT_AT },
    });
    expect(screen.queryByTestId("html-output-panel")).not.toBeInTheDocument();
  });

  it("leaves a failed first build to the usual error state", () => {
    show({ status: "unavailable", htmlOutput: null });
    expect(screen.queryByTestId("html-output-panel")).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(enPreview.empty.compileUnavailable);
  });
});
