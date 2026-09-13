// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import enResearchTools from "@/i18n/locales/en/researchTools.json" with { type: "json" };
import { useHomeViewStore } from "@/store/home-view";
import { useFilesStore } from "@/store/files";
import { toolName } from "@/lib/tool-catalog";

const mocks = vi.hoisted(() => ({
  createImageProject: vi.fn(),
  equationToSvgDocument: vi.fn(),
  listFiles: vi.fn(),
  projectMutationGeneration: vi.fn(),
  refreshProjects: vi.fn(),
  svgDocumentToPngBytes: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  writeProjectBytes: vi.fn(),
}));

vi.mock("./EquationPreviewPanel", () => ({
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
  toast: { error: mocks.toastError, success: mocks.toastSuccess },
}));
vi.mock("@/features/equation-export", () => ({
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

beforeEach(() => {
  vi.clearAllMocks();
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

  it("copies the display-wrapped source from the header", async () => {
    render(<EquationToolView />);
    fireEvent.click(
      screen.getByRole("button", { name: enResearchTools.equation.copyLatex }),
    );
    await vi.waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(
        `\\[ ${EQUATION_EXAMPLES[0].latex} \\]`,
      );
      expect(mocks.toastSuccess).toHaveBeenCalledWith(
        enResearchTools.equation.copiedSource,
      );
    });
  });

  it("reports a clipboard failure when MathML cannot be copied", async () => {
    writeText.mockRejectedValueOnce(new Error("clipboard denied"));
    render(<EquationToolView />);
    fireEvent.click(
      screen.getByRole("button", { name: enResearchTools.equation.copyMathml }),
    );
    await vi.waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith("clipboard denied"));
  });

  it("reports a clipboard failure when LaTeX cannot be copied", async () => {
    writeText.mockRejectedValueOnce(new Error("clipboard denied"));
    render(<EquationToolView />);
    fireEvent.click(
      screen.getByRole("button", { name: enResearchTools.equation.copyLatex }),
    );
    await vi.waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith("clipboard denied"));
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

  it("reports an image export failure when the equation cannot be rendered", async () => {
    mocks.equationToSvgDocument.mockRejectedValueOnce("no renderer");
    render(<EquationToolView />);
    fireEvent.click(
      screen.getByRole("button", {
        name: enResearchTools.equation.downloadPng,
      }),
    );
    await vi.waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        enResearchTools.equation.exportImageFailed,
      ),
    );
  });

  it("can keep an equation as a reusable image project", async () => {
    mocks.createImageProject.mockResolvedValue("project-1");
    mocks.refreshProjects.mockResolvedValue(undefined);
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
  });

  it("saves a rendered PNG into an existing project without racing newer edits", async () => {
    useFilesStore.setState({
      projects: [{
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
      }],
    });
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
