// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useHomeViewStore } from "@/store/home-view";
import { useFilesStore } from "@/store/files";

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
vi.mock("@/components/layout/ThemeControls", () => ({ ThemeMenu: () => <div /> }));
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
  Object.assign(navigator, { clipboard: { writeText: vi.fn() } });
  vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("clipboard denied"));
});

describe("EquationToolView", () => {
  it("reports a clipboard failure when MathML cannot be copied", async () => {
    render(<EquationToolView />);
    fireEvent.click(screen.getByRole("button", { name: /Copy MathML for Word/i }));
    await vi.waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith("clipboard denied"));
  });

  it("reports a clipboard failure when LaTeX cannot be copied", async () => {
    render(<EquationToolView />);
    fireEvent.click(screen.getByRole("button", { name: /Copy LaTeX/i }));
    await vi.waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith("clipboard denied"));
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
