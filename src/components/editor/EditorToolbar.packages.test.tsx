// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "@/i18n/locales/en/editor.json" with { type: "json" };
import { LATEX_ENGINE } from "@/lib/document-engine";
import { useFilesStore } from "@/store/files";

const opener = vi.hoisted(() => ({ openLatexPackages: vi.fn() }));

vi.mock("@/components/packages/open", () => opener);
vi.mock("@oleafly/preview", () => ({
  registerPdfView: vi.fn(),
  clearPdfView: vi.fn(),
  gotoRect: vi.fn(),
  pageClickToBp: vi.fn(),
  setPdfLogger: vi.fn(),
}));
vi.mock("@/components/editor/project-info-data", () => ({ collectProjectInfo: vi.fn() }));
vi.mock("@/features/image-to-latex", () => ({
  imageToLatexAvailable: vi.fn(async () => false),
  imageToLatex: vi.fn(async () => {}),
}));

import { EditorToolbar } from "./EditorToolbar";

vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

const initial = useFilesStore.getState();

afterEach(() => {
  useFilesStore.setState({ engine: initial.engine, engineLoaded: initial.engineLoaded });
});

describe("EditorToolbar packages button", () => {
  it("opens the LaTeX package browser for a LaTeX project", () => {
    useFilesStore.setState({ engine: { ...LATEX_ENGINE, id: "latexmk" }, engineLoaded: true });
    render(<EditorToolbar wysiwyg={false} onToggleWysiwyg={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: en.toolbar.latexPackages }));
    expect(opener.openLatexPackages).toHaveBeenCalledOnce();
  });

  it("is hidden until a LaTeX engine is loaded", () => {
    useFilesStore.setState({ engine: { ...LATEX_ENGINE, source_format: "typst", id: "typst" }, engineLoaded: true });
    const { unmount } = render(<EditorToolbar wysiwyg={false} onToggleWysiwyg={vi.fn()} />);
    expect(screen.queryByRole("button", { name: en.toolbar.latexPackages })).not.toBeInTheDocument();
    unmount();
    useFilesStore.setState({ engine: LATEX_ENGINE, engineLoaded: false });
    render(<EditorToolbar wysiwyg={false} onToggleWysiwyg={vi.fn()} />);
    expect(screen.queryByRole("button", { name: en.toolbar.latexPackages })).not.toBeInTheDocument();
  });
});
