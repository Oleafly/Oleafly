// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const PAGE_URL = "http://127.0.0.1:4321/0123abcd/report.html";

const mocks = vi.hoisted(() => ({
  openCompiledHtml: vi.fn(async (_projectId: string) => {}),
  compiledHtmlPreviewUrl: vi.fn(async (_projectId: string) => "http://127.0.0.1:4321/0123abcd/report.html"),
}));

vi.mock("@/components/pdf/PdfViewer", () => ({ PdfViewer: () => null }));
vi.mock("@/components/editor/LogPane", () => ({ LogPane: () => null }));
vi.mock("@/features/synctex", () => ({
  canUseSyncTexForCheckpoint: vi.fn(() => false),
  inverseFromClick: vi.fn(),
}));
vi.mock("@/features/ask-ai-compile-errors", () => ({ askAiAboutCompileErrors: vi.fn() }));
vi.mock("@/lib/preview-window", () => ({ openPreviewWindow: vi.fn() }));
vi.mock("@/lib/notebook-commands", () => ({
  openCompiledHtml: mocks.openCompiledHtml,
  compiledHtmlPreviewUrl: mocks.compiledHtmlPreviewUrl,
}));
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
  it("shows the built page in the preview and still opens it in the browser from the toolbar", async () => {
    show();
    const page = await screen.findByTitle("report.html");
    expect(mocks.compiledHtmlPreviewUrl).toHaveBeenCalledExactlyOnceWith("p1");
    expect(page.tagName).toBe("IFRAME");
    expect(page).toHaveAttribute("src", `${PAGE_URL}?v=${BUILT_AT}`);
    expect(page.getAttribute("sandbox")?.split(" ")).not.toContain("allow-top-navigation");
    expect(page).toHaveAttribute("allow", "fullscreen");
    expect(screen.getByRole("button", { name: enPreview.actions.downloadPdf })).toBeDisabled();
    await userEvent.setup().click(screen.getByRole("button", { name: copy.open }));
    expect(mocks.openCompiledHtml).toHaveBeenCalledExactlyOnceWith("p1");
  });

  it("reloads the page after each build", async () => {
    show();
    expect(await screen.findByTitle("report.html")).toHaveAttribute("src", `${PAGE_URL}?v=${BUILT_AT}`);
    useCompileStore.setState({
      htmlOutput: { projectId: "p1", path: "/p1/.oleafly/build/report.html", builtAt: BUILT_AT + 1 },
    });
    await waitFor(() =>
      expect(screen.getByTitle("report.html")).toHaveAttribute("src", `${PAGE_URL}?v=${BUILT_AT + 1}`),
    );
  });

  it("offers the browser when the page cannot be shown here", async () => {
    mocks.compiledHtmlPreviewUrl.mockRejectedValueOnce(
      `${APP_ERROR_PREFIX}${JSON.stringify({ code: "notebook.open_html_failed", params: {}, detail: null })}`,
    );
    show();
    const panel = await screen.findByRole("status");
    await waitFor(() => expect(panel).toHaveTextContent(enErrors.notebook.open_html_failed));
    expect(screen.queryByTitle("report.html")).not.toBeInTheDocument();
    const [inPanel] = within(panel).getAllByRole("button", { name: copy.open });
    await userEvent.setup().click(inPanel);
    expect(mocks.openCompiledHtml).toHaveBeenCalledExactlyOnceWith("p1");
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
    expect(await screen.findByTitle("report.html")).toHaveAttribute("src", `${PAGE_URL}?v=${BUILT_AT}`);
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

  it("drops the old page as soon as the document builds a PDF, before the next compile", () => {
    show({ engine: quarto("pdf"), status: "idle" });
    expect(screen.queryByTestId("html-output-panel")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: copy.open })).not.toBeInTheDocument();
  });

  it("drops the old page when the main document moves to another engine", () => {
    show({ engine: LATEX_ENGINE, status: "success" });
    expect(screen.queryByTestId("html-output-panel")).not.toBeInTheDocument();
  });

  it("leaves a failed first build to the usual error state", () => {
    show({ status: "unavailable", htmlOutput: null });
    expect(screen.queryByTestId("html-output-panel")).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(enPreview.empty.compileUnavailable);
  });
});
