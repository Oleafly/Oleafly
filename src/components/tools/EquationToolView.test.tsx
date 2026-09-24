// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import enCommon from "@/i18n/locales/en/common.json" with { type: "json" };
import enResearchTools from "@/i18n/locales/en/researchTools.json" with { type: "json" };
import { useHomeViewStore } from "@/store/home-view";
import { useFilesStore } from "@/store/files";
import { toolName } from "@/lib/tool-catalog";

const mocks = vi.hoisted(() => ({
  createImageProject: vi.fn(),
  equationToSvgDocument: vi.fn(),
  listFiles: vi.fn(),
  logError: vi.fn(),
  notifyError: vi.fn(),
  projectMutationGeneration: vi.fn(),
  refreshProjects: vi.fn(),
  svgDocumentToPngBytes: vi.fn(),
  toastDismiss: vi.fn(),
  toastError: vi.fn(),
  toastKey: vi.fn(),
  toastSuccess: vi.fn(),
  writeProjectBytes: vi.fn(),
}));

vi.mock("./EquationPreviewPanel", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./EquationPreviewPanel")>()),
  EQUATION_EXAMPLES: [{ latex: "x" }],
  EquationPreviewPanel: () => <div />,
  renderEquation: () => ({ html: "<math />", error: null }),
}));
vi.mock("@/components/ui/popover", () => ({
  Popover: ({ trigger, children }: { trigger: ReactNode; children: ReactNode }) => <div>{trigger}{children}</div>,
  PopoverItem: ({ children, onClick }: { children: ReactNode; onClick: () => void }) => <button type="button" onClick={onClick}>{children}</button>,
}));
vi.mock("@/components/layout/ThemeControls", () => ({
  ThemeMenu: ({ testId }: { testId?: string }) => <div data-testid={testId} />,
}));
vi.mock("@/components/layout/WindowControls", () => ({ WindowControls: () => <div /> }));
vi.mock("@/lib/use-fullscreen", () => ({ useFullscreen: () => false }));
vi.mock("@/lib/toast", () => ({
  notifyError: mocks.notifyError,
  toast: {
    dismiss: mocks.toastDismiss,
    error: mocks.toastError,
    success: mocks.toastSuccess,
    errorUnique: (key: string, message: string) => {
      mocks.toastKey(key);
      return mocks.toastError(message);
    },
    successUnique: (key: string, message: string) => {
      mocks.toastKey(key);
      return mocks.toastSuccess(message);
    },
  },
}));
vi.mock("@/lib/log", () => ({ logError: mocks.logError }));
vi.mock("@/features/equation-export", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/equation-export")>()),
  equationToSvgDocument: mocks.equationToSvgDocument,
  svgDocumentToPngBytes: mocks.svgDocumentToPngBytes,
}));
vi.mock("@/lib/tauri", () => ({
  createImageProject: mocks.createImageProject,
  listFiles: mocks.listFiles,
  projectMutationGeneration: mocks.projectMutationGeneration,
  writeProjectBytes: mocks.writeProjectBytes,
}));

import { EquationToolView } from "./EquationToolView";
import { EQUATION_EXAMPLES } from "./EquationPreviewPanel";

const writeText = vi.fn(async () => {});

const PAPER = {
  id: "paper",
  name: "Paper",
  main_doc: "main.tex",
  engine: "xetex",
  kind: "",
  created_at: 0,
  updated_at: 0,
  has_preview: false,
  exports: [],
  forked_from: null,
  recovery_pending: false,
};

let toastId = 0;

beforeEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  toastId = 0;
  mocks.toastSuccess.mockImplementation(() => ++toastId);
  mocks.toastError.mockImplementation(() => ++toastId);
  mocks.refreshProjects.mockResolvedValue(undefined);
  useHomeViewStore.setState({ page: "equation" });
  useFilesStore.setState({
    projects: [],
    refreshProjects: mocks.refreshProjects,
  });
  mocks.listFiles.mockResolvedValue([]);
  mocks.projectMutationGeneration.mockResolvedValue(0);
  mocks.equationToSvgDocument.mockResolvedValue("<svg />");
  mocks.svgDocumentToPngBytes.mockResolvedValue(new Uint8Array([1, 2, 3]));
  mocks.writeProjectBytes.mockResolvedValue({ generation: 1 });
  writeText.mockReset();
  writeText.mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: vi.fn(() => "blob:equation"),
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: vi.fn(),
  });
  HTMLAnchorElement.prototype.click = vi.fn();
});

describe("EquationToolView", () => {
  it("renders nothing when another page is active", () => {
    useHomeViewStore.setState({ page: "library" });
    const { container } = render(<EquationToolView />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the header, the seeded equation and the rendered status", () => {
    render(<EquationToolView />);
    expect(screen.getByTestId("equation-tool-view")).toBeInTheDocument();
    expect(screen.getByText(toolName("equation"))).toBeInTheDocument();
    expect(
      screen.getByText(enResearchTools.equation.subtitle),
    ).toBeInTheDocument();
    expect(
      screen.getByText(enResearchTools.equation.statusRendered),
    ).toBeInTheDocument();
    expect(screen.getByTestId("equation-theme-menu")).toBeInTheDocument();
  });

  it("goes back to the tools gallery", () => {
    render(<EquationToolView />);
    fireEvent.click(screen.getByTestId("equation-tool-view-back"));
    expect(useHomeViewStore.getState().page).toBe("tools");
  });

  it("confirms a header copy on the button instead of a toast", async () => {
    render(<EquationToolView />);
    fireEvent.click(
      screen.getByRole("button", { name: enResearchTools.equation.copyLatex }),
    );
    await vi.waitFor(() =>
      expect(screen.getByRole("button", { name: enCommon.actions.copied })).toBeInTheDocument(),
    );
    expect(writeText).toHaveBeenCalledWith(`\\[ ${EQUATION_EXAMPLES[0].latex} \\]`);
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
    expect(mocks.toastError).not.toHaveBeenCalled();
  });

  it("returns the header copy button to its label after a moment", async () => {
    vi.useFakeTimers();
    render(<EquationToolView />);
    fireEvent.click(
      screen.getByRole("button", { name: enResearchTools.equation.copyLatex }),
    );
    await act(async () => {});
    expect(screen.getByRole("button", { name: enCommon.actions.copied })).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1500));
    expect(
      screen.getByRole("button", { name: enResearchTools.equation.copyLatex }),
    ).toBeInTheDocument();
    vi.useRealTimers();
  });

  it("shows a localized MathML copy failure and logs the raw error", async () => {
    const denied = new Error("clipboard denied");
    writeText.mockRejectedValueOnce(denied);
    render(<EquationToolView />);
    fireEvent.click(
      screen.getByRole("button", { name: enResearchTools.equation.copyMathml }),
    );
    await vi.waitFor(() =>
      expect(mocks.notifyError).toHaveBeenCalledWith(
        "equation copy mathml",
        denied,
        enResearchTools.equation.mathmlFailed,
      ),
    );
    expect(mocks.toastError).not.toHaveBeenCalled();
  });

  it("shows a localized KaTeX HTML copy failure and logs the raw error", async () => {
    const denied = new DOMException("Document is not focused.", "NotAllowedError");
    writeText.mockRejectedValueOnce(denied);
    render(<EquationToolView />);
    fireEvent.click(
      screen.getByRole("button", { name: enResearchTools.equation.copyKatexHtml }),
    );
    await vi.waitFor(() =>
      expect(mocks.notifyError).toHaveBeenCalledWith(
        "equation copy katex html",
        denied,
        enResearchTools.equation.copyKatexFailed,
      ),
    );
  });

  it("shows a failed header copy on the button and logs it", async () => {
    const denied = new Error("clipboard denied");
    writeText.mockRejectedValueOnce(denied);
    render(<EquationToolView />);
    fireEvent.click(
      screen.getByRole("button", { name: enResearchTools.equation.copyLatex }),
    );
    await vi.waitFor(() =>
      expect(
        screen.getByRole("button", { name: enResearchTools.equation.copyLatexFailed }),
      ).toBeInTheDocument(),
    );
    expect(mocks.logError).toHaveBeenCalledWith("equation copy latex", denied);
    expect(mocks.toastError).not.toHaveBeenCalled();
  });

  it("copies MathML from the export menu", async () => {
    render(<EquationToolView />);
    fireEvent.click(
      screen.getByRole("button", { name: enResearchTools.equation.copyMathml }),
    );
    await vi.waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(expect.stringContaining("<math"));
      expect(mocks.toastSuccess).toHaveBeenCalledWith(
        enResearchTools.equation.copiedMathml,
      );
    });
  });

  it("copies the rendered markup from the export menu", async () => {
    render(<EquationToolView />);
    fireEvent.click(
      screen.getByRole("button", {
        name: enResearchTools.equation.copyKatexHtml,
      }),
    );
    await vi.waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("<math />");
      expect(mocks.toastSuccess).toHaveBeenCalledWith(
        enResearchTools.equation.copiedKatexHtml,
      );
    });
  });

  it("downloads an SVG from the export menu", async () => {
    render(<EquationToolView />);
    fireEvent.click(
      screen.getByRole("button", {
        name: enResearchTools.equation.downloadSvg,
      }),
    );
    await vi.waitFor(() => {
      expect(mocks.equationToSvgDocument).toHaveBeenCalled();
      expect(URL.createObjectURL).toHaveBeenCalled();
      expect(HTMLAnchorElement.prototype.click).toHaveBeenCalled();
    });
  });

  it("renders and downloads a PNG from the export menu", async () => {
    render(<EquationToolView />);
    fireEvent.click(
      screen.getByRole("button", {
        name: enResearchTools.equation.downloadPng,
      }),
    );
    await vi.waitFor(() => {
      expect(mocks.svgDocumentToPngBytes).toHaveBeenCalled();
      expect(HTMLAnchorElement.prototype.click).toHaveBeenCalled();
    });
    expect(mocks.toastError).not.toHaveBeenCalled();
  });

  it("reports an image export failure in the catalog text, whatever the renderer threw", async () => {
    const raster = new Error("the SVG could not be rasterized");
    mocks.equationToSvgDocument.mockRejectedValueOnce("no renderer");
    mocks.svgDocumentToPngBytes.mockRejectedValueOnce(raster);
    render(<EquationToolView />);
    const downloadPng = screen.getByRole("button", { name: enResearchTools.equation.downloadPng });

    fireEvent.click(downloadPng);
    await vi.waitFor(() =>
      expect(mocks.notifyError).toHaveBeenCalledWith(
        "equation export png",
        "no renderer",
        enResearchTools.equation.exportImageFailed,
      ),
    );

    fireEvent.click(downloadPng);
    await vi.waitFor(() =>
      expect(mocks.notifyError).toHaveBeenLastCalledWith(
        "equation export png",
        raster,
        enResearchTools.equation.exportImageFailed,
      ),
    );
    expect(mocks.toastError).not.toHaveBeenCalled();
  });

  it("reports an SVG export failure in the catalog text", async () => {
    const mathjax = new Error("MathJax could not render this equation: Missing argument");
    mocks.equationToSvgDocument.mockRejectedValueOnce(mathjax);
    render(<EquationToolView />);
    fireEvent.click(screen.getByRole("button", { name: enResearchTools.equation.downloadSvg }));

    await vi.waitFor(() =>
      expect(mocks.notifyError).toHaveBeenCalledWith(
        "equation export svg",
        mathjax,
        enResearchTools.equation.exportSvgFailed,
      ),
    );
  });

  it("can keep an equation as a reusable image project", async () => {
    mocks.createImageProject.mockResolvedValue("project-1");
    render(<EquationToolView />);

    fireEvent.click(screen.getByRole("button", { name: /New image project/i }));

    await vi.waitFor(() => {
      expect(mocks.createImageProject).toHaveBeenCalledWith(
        "equation",
        expect.stringContaining("\\documentclass[border=6pt]{standalone}"),
      );
      expect(mocks.toastSuccess).toHaveBeenCalledWith(
        "Saved as a new image project. You can open it from the Library.",
      );
    });
    await vi.waitFor(() => expect(mocks.refreshProjects).toHaveBeenCalled());
  });

  it("does not claim a created project failed when only the list refresh fails", async () => {
    const offline = new Error("list offline");
    mocks.createImageProject.mockResolvedValue("project-1");
    mocks.refreshProjects.mockRejectedValue(offline);
    render(<EquationToolView />);

    fireEvent.click(screen.getByRole("button", { name: /New image project/i }));

    await vi.waitFor(() =>
      expect(mocks.logError).toHaveBeenCalledWith("equation refresh projects", offline),
    );
    expect(mocks.toastSuccess).toHaveBeenCalledWith(enResearchTools.equation.projectCreated);
    expect(mocks.toastError).not.toHaveBeenCalled();
    expect(mocks.createImageProject).toHaveBeenCalledOnce();
  });

  it("keeps the reason of an app error when a project cannot be created", async () => {
    const conflict = '@oleafly/error:{"code":"project.name_conflict","params":{"name":"equation"}}';
    mocks.createImageProject.mockRejectedValue(conflict);
    render(<EquationToolView />);

    fireEvent.click(screen.getByRole("button", { name: /New image project/i }));

    await vi.waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith("A project named equation already exists."),
    );
    expect(mocks.logError).toHaveBeenCalledWith("equation create image project", conflict);
  });

  it("uses the catalog text for a project creation failure without a known reason", async () => {
    mocks.createImageProject.mockRejectedValue(new Error("Error: invoke failed"));
    render(<EquationToolView />);

    fireEvent.click(screen.getByRole("button", { name: /New image project/i }));

    await vi.waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(enResearchTools.equation.projectCreateFailed),
    );
  });

  it("replaces the previous project outcome instead of stacking a second one", async () => {
    useFilesStore.setState({ projects: [PAPER] });
    render(<EquationToolView />);
    const fileName = screen.getByLabelText(enResearchTools.equation.pngFileName);

    fireEvent.change(fileName, { target: { value: "bad/name" } });
    fireEvent.click(screen.getByRole("button", { name: "Paper" }));
    expect(mocks.toastError).toHaveBeenCalledWith(enResearchTools.equation.invalidPngName);
    expect(mocks.writeProjectBytes).not.toHaveBeenCalled();

    fireEvent.change(fileName, { target: { value: "fixed" } });
    fireEvent.click(screen.getByRole("button", { name: "Paper" }));

    await vi.waitFor(() =>
      expect(mocks.toastSuccess).toHaveBeenCalledWith("Saved figures/fixed.png to Paper."),
    );
    expect(mocks.toastKey).toHaveBeenCalledTimes(2);
    expect(mocks.toastKey.mock.calls[1][0]).toBe(mocks.toastKey.mock.calls[0][0]);
    expect(mocks.toastDismiss).not.toHaveBeenCalled();
  });

  it("reports a failed save to a project in the catalog text and logs the cause", async () => {
    useFilesStore.setState({ projects: [PAPER] });
    const failure = new Error("canvas is unavailable in this window");
    mocks.svgDocumentToPngBytes.mockRejectedValue(failure);
    render(<EquationToolView />);

    fireEvent.click(screen.getByRole("button", { name: "Paper" }));

    await vi.waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(enResearchTools.equation.saveFailed),
    );
    expect(mocks.logError).toHaveBeenCalledWith("equation save to project", failure);
    expect(mocks.writeProjectBytes).not.toHaveBeenCalled();
    expect(mocks.refreshProjects).not.toHaveBeenCalled();
  });

  it("does not claim a written PNG failed when only the list refresh fails", async () => {
    useFilesStore.setState({ projects: [PAPER] });
    mocks.refreshProjects.mockRejectedValue(new Error("list offline"));
    render(<EquationToolView />);

    fireEvent.click(screen.getByRole("button", { name: "Paper" }));

    await vi.waitFor(() =>
      expect(mocks.toastSuccess).toHaveBeenCalledWith("Saved figures/equation.png to Paper."),
    );
    await vi.waitFor(() => expect(mocks.logError).toHaveBeenCalledWith(
      "equation refresh projects",
      expect.any(Error),
    ));
    expect(mocks.toastError).not.toHaveBeenCalled();
  });

  it("confirms a new project after the project list has refreshed, as before", async () => {
    mocks.createImageProject.mockResolvedValue("project-1");
    render(<EquationToolView />);

    fireEvent.click(screen.getByRole("button", { name: /New image project/i }));

    await vi.waitFor(() =>
      expect(mocks.toastSuccess).toHaveBeenCalledWith(enResearchTools.equation.projectCreated),
    );
    expect(mocks.refreshProjects.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.toastSuccess.mock.invocationCallOrder[0],
    );
  });

  it("holds the save guard until the list refresh settles", async () => {
    useFilesStore.setState({ projects: [PAPER] });
    let settle!: () => void;
    mocks.refreshProjects.mockReturnValue(new Promise<void>((resolve) => { settle = resolve; }));
    render(<EquationToolView />);

    fireEvent.click(screen.getByRole("button", { name: "Paper" }));
    await vi.waitFor(() => expect(mocks.refreshProjects).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole("button", { name: "Paper" }));
    fireEvent.click(screen.getByRole("button", { name: /New image project/i }));
    expect(mocks.writeProjectBytes).toHaveBeenCalledOnce();
    expect(mocks.createImageProject).not.toHaveBeenCalled();

    await act(async () => settle());
    expect(mocks.toastSuccess).toHaveBeenCalledExactlyOnceWith("Saved figures/equation.png to Paper.");
  });

  it("lets a repeated identical project outcome merge instead of replacing it", async () => {
    useFilesStore.setState({ projects: [PAPER] });
    render(<EquationToolView />);
    const fileName = screen.getByLabelText(enResearchTools.equation.pngFileName);
    fireEvent.change(fileName, { target: { value: "bad/name" } });

    fireEvent.click(screen.getByRole("button", { name: "Paper" }));
    mocks.toastDismiss.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Paper" }));

    expect(mocks.toastError).toHaveBeenCalledTimes(2);
    expect(mocks.toastDismiss).not.toHaveBeenCalled();
  });

  it("saves a rendered PNG into an existing project without racing newer edits", async () => {
    useFilesStore.setState({ projects: [PAPER] });
    mocks.projectMutationGeneration.mockResolvedValue(7);
    render(<EquationToolView />);

    fireEvent.click(screen.getByRole("button", { name: "Paper" }));

    await vi.waitFor(() => {
      expect(mocks.writeProjectBytes).toHaveBeenCalledWith(
        "paper",
        "figures/equation.png",
        "AQID",
        7,
      );
      expect(mocks.toastSuccess).toHaveBeenCalledWith(
        "Saved figures/equation.png to Paper.",
      );
    });
  });
});
