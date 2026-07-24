// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("@oleafly/preview", () => ({
  registerPdfView: vi.fn(),
  clearPdfView: vi.fn(),
  gotoRect: vi.fn(),
  pageClickToBp: vi.fn(),
  setPdfLogger: vi.fn(),
}));

import { EditorToolbar } from "./EditorToolbar";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverStub);

describe("EditorToolbar wysiwyg toggle", () => {
  it("shows a Code/Visual segmented switch and calls onToggleWysiwyg when the Visual segment is clicked while off", () => {
    const onToggleWysiwyg = vi.fn();
    render(<EditorToolbar wysiwyg={false} onToggleWysiwyg={onToggleWysiwyg} />);
    expect(screen.getByLabelText("Switch to source view")).toHaveTextContent("Code");
    const visualBtn = screen.getByLabelText("Switch to WYSIWYG view");
    expect(visualBtn).toHaveTextContent("Visual");
    fireEvent.click(visualBtn);
    expect(onToggleWysiwyg).toHaveBeenCalledTimes(1);
  });

  it("does not call onToggleWysiwyg when clicking the already-active segment", () => {
    const onToggleWysiwyg = vi.fn();
    render(<EditorToolbar wysiwyg={true} onToggleWysiwyg={onToggleWysiwyg} />);
    fireEvent.click(screen.getByLabelText("Switch to WYSIWYG view"));
    expect(onToggleWysiwyg).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText("Switch to source view"));
    expect(onToggleWysiwyg).toHaveBeenCalledTimes(1);
  });
});
