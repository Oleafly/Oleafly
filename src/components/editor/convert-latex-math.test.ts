import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  view: {} as object | null,
  convert: vi.fn(),
  infoUnique: vi.fn(),
  notifyError: vi.fn(),
}));

vi.mock("./cm/controller", () => ({ getEditorView: () => mocks.view }));
vi.mock("@oleafly/editor/typst-math-paste", () => ({ convertLatexMathSelection: mocks.convert }));
vi.mock("@/lib/toast", () => ({ toast: { infoUnique: mocks.infoUnique }, notifyError: mocks.notifyError }));

import { convertLatexMathAtSelection } from "./convert-latex-math";

afterEach(() => {
  vi.clearAllMocks();
  mocks.view = {};
});

describe("convertLatexMathAtSelection", () => {
  it("converts quietly when there is LaTeX math", async () => {
    mocks.convert.mockResolvedValue(true);
    await convertLatexMathAtSelection();
    expect(mocks.convert).toHaveBeenCalledWith(mocks.view);
    expect(mocks.infoUnique).not.toHaveBeenCalled();
  });

  it("says once that there is nothing to convert", async () => {
    mocks.convert.mockResolvedValue(false);
    await convertLatexMathAtSelection();
    expect(mocks.infoUnique).toHaveBeenCalledWith("convert-latex-math", "Select some LaTeX math first.");
  });

  it("does nothing without an editor", async () => {
    mocks.view = null;
    await convertLatexMathAtSelection();
    expect(mocks.convert).not.toHaveBeenCalled();
  });

  it("reports a failure", async () => {
    mocks.convert.mockRejectedValue(new Error("boom"));
    await convertLatexMathAtSelection();
    expect(mocks.notifyError).toHaveBeenCalledWith("convert latex math", expect.any(Error));
  });
});
