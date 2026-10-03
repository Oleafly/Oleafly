// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import en from "@/i18n/locales/en/editor.json" with { type: "json" };

const controller = vi.hoisted(() => ({
  editorFind: vi.fn(),
  editorRedo: vi.fn(),
  editorUndo: vi.fn(),
  getEditorView: vi.fn(() => null),
  insertAtCursor: vi.fn(),
  insertEnvironment: vi.fn(),
  insertTemplate: vi.fn(),
  wrapSelectionOrPlaceholder: vi.fn(),
}));

vi.mock("@oleafly/preview", () => ({
  registerPdfView: vi.fn(),
  clearPdfView: vi.fn(),
  gotoRect: vi.fn(),
  pageClickToBp: vi.fn(),
  setPdfLogger: vi.fn(),
}));
vi.mock("@/components/editor/project-info-data", () => ({ collectProjectInfo: vi.fn() }));
vi.mock("@/components/editor/cm/controller", () => controller);
vi.mock("@/features/image-to-latex", () => ({
  imageToLatexAvailable: vi.fn(async () => false),
  imageToTypst: vi.fn(async () => {}),
  imageToLatex: vi.fn(async () => {}),
}));

import { useFilesStore } from "@/store/files";
import { TypstToolbar } from "./TypstToolbar";

describe("TypstToolbar visual switch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useFilesStore.setState({ activePath: "main.typ", files: { "main.typ": { content: "= A\n" } } } as never);
  });

  it("switches between the code and visual surfaces", () => {
    const toggle = vi.fn();
    const { rerender } = render(<TypstToolbar wysiwyg={false} onToggleWysiwyg={toggle} />);
    expect(screen.getByLabelText(en.toolbar.switchToSource)).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByLabelText(en.toolbar.switchToVisual));
    expect(toggle).toHaveBeenCalledOnce();
    rerender(<TypstToolbar wysiwyg onToggleWysiwyg={toggle} />);
    expect(screen.getByLabelText(en.toolbar.switchToVisual)).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(en.toolbar.visual)).toBeInTheDocument();
  });

  it("has no switch when the host offers no visual mode", () => {
    render(<TypstToolbar />);
    expect(screen.queryByLabelText(en.toolbar.switchToVisual)).not.toBeInTheDocument();
  });
});
