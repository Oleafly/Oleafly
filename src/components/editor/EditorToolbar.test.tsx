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
  it("shows WYS label and calls onToggleWysiwyg when off", () => {
    const onToggleWysiwyg = vi.fn();
    render(<EditorToolbar wysiwyg={false} onToggleWysiwyg={onToggleWysiwyg} />);
    const btn = screen.getByLabelText("Switch to WYSIWYG view");
    expect(btn).toHaveTextContent("WYS");
    fireEvent.click(btn);
    expect(onToggleWysiwyg).toHaveBeenCalledTimes(1);
  });

  it("shows SRC label when wysiwyg is on", () => {
    render(<EditorToolbar wysiwyg={true} onToggleWysiwyg={vi.fn()} />);
    expect(screen.getByLabelText("Switch to source view")).toHaveTextContent("SRC");
  });
});
