// @vitest-environment jsdom
import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { latexMathToTypst } from "@oleafly/editor/latex-to-typst-math";
import enResearchTools from "@/i18n/locales/en/researchTools.json" with { type: "json" };

const mocks = vi.hoisted(() => ({ renderTypstSnippet: vi.fn() }));

vi.mock("@/lib/tauri", () => ({ renderTypstSnippet: mocks.renderTypstSnippet }));
vi.mock("@/lib/log", () => ({ logError: vi.fn() }));

import {
  EQUATION_EXAMPLES,
  EquationPreviewPanel,
  type TypstEquationPreview,
  typstEquationSource,
  useTypstEquationPreview,
} from "@/components/tools/EquationPreviewPanel";

const equation = enResearchTools.equation;
const onInputChange = vi.fn();

function renderTypstPanel(typst: TypstEquationPreview, display = true, input = "x^2") {
  return render(
    <EquationPreviewPanel
      language="typst"
      typst={typst}
      input={input}
      onInputChange={onInputChange}
      display={display}
      onDisplayChange={vi.fn()}
      rendered={{ html: "", error: null }}
      wrapped={display ? `$ ${input} $` : `$${input}$`}
      previewTheme="dark"
      onPreviewThemeChange={vi.fn()}
      zoom={100}
      onZoomChange={vi.fn()}
      editorTheme="oleafly-dark"
    />,
  );
}

beforeEach(() => {
  onInputChange.mockReset();
  mocks.renderTypstSnippet.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("EquationPreviewPanel in Typst mode", () => {
  it("shows the Typst heading and the rendered SVG", () => {
    renderTypstPanel({ status: "rendered", svg: "<svg>ok</svg>" });
    expect(screen.getByText(equation.sourceHeadingTypst)).toBeInTheDocument();
    const image = screen.getByTestId("equation-typst-image");
    expect(image.getAttribute("src")).toBe(`data:image/svg+xml;charset=utf-8,${encodeURIComponent("<svg>ok</svg>")}`);
  });

  it("offers the examples as Typst, converted from LaTeX, and leaves out chemistry", () => {
    renderTypstPanel({ status: "idle" });
    fireEvent.click(screen.getByRole("button", { name: equation.example.quadratic }));
    expect(onInputChange).toHaveBeenCalledWith(latexMathToTypst(EQUATION_EXAMPLES[0].latex));
    expect(screen.queryByRole("button", { name: equation.example.chemistry })).toBeNull();
  });

  it("shows the Typst error message", () => {
    renderTypstPanel({ status: "error", message: "unknown variable: foo" });
    expect(screen.getByText("unknown variable: foo")).toBeInTheDocument();
    expect(screen.queryByTestId("equation-typst-image")).toBeNull();
  });

  it("dims the previous image while the next one renders", () => {
    renderTypstPanel({ status: "rendering", svg: "<svg>old</svg>" });
    expect(screen.getByTestId("equation-typst-image")).toHaveClass("opacity-50");
  });

  it("places an inline equation in the sample sentence", () => {
    renderTypstPanel({ status: "rendered", svg: "<svg/>" }, false);
    expect(screen.getByTestId("equation-typst-image").closest("p")?.textContent).toContain("flowing with the surrounding text");
  });

  it("asks for Typst math when the source is empty", () => {
    renderTypstPanel({ status: "idle" }, true, "  ");
    expect(screen.getByText(equation.emptyTypst)).toBeInTheDocument();
  });
});

describe("typstEquationSource", () => {
  it("colours the text for the preview backdrop and keeps display spacing", () => {
    expect(typstEquationSource(" x ", true, "dark")).toBe('#set text(fill: rgb("#ffffff"), size: 15pt)\n$ x $');
    expect(typstEquationSource("x", false, "light")).toBe('#set text(fill: rgb("#000000"), size: 15pt)\n$x$');
  });
});

describe("useTypstEquationPreview", () => {
  it("renders after a pause and serves repeats from the cache", async () => {
    vi.useFakeTimers();
    mocks.renderTypstSnippet.mockResolvedValue({
      status: "rendered",
      image: { format: "svg", svg: "<svg>a</svg>" },
      diagnostics: [],
    });
    const { result, rerender } = renderHook(({ input }) => useTypstEquationPreview(input, true, "dark", true), {
      initialProps: { input: "a + 1" },
    });
    expect(result.current.status).toBe("rendering");
    rerender({ input: "a + 2" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(mocks.renderTypstSnippet).toHaveBeenCalledTimes(1);
    expect(mocks.renderTypstSnippet).toHaveBeenCalledWith({
      source: typstEquationSource("a + 2", true, "dark"),
      format: "svg",
    });
    expect(result.current).toEqual({ status: "rendered", svg: "<svg>a</svg>" });

    rerender({ input: "a + 3" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    rerender({ input: "a + 2" });
    expect(result.current).toEqual({ status: "rendered", svg: "<svg>a</svg>" });
    expect(mocks.renderTypstSnippet).toHaveBeenCalledTimes(2);
  });

  it("reports the first Typst error", async () => {
    vi.useFakeTimers();
    mocks.renderTypstSnippet.mockResolvedValue({
      status: "failed",
      diagnostics: [{ severity: "error", message: "unclosed delimiter", line: 1, column: 2 }],
    });
    const { result } = renderHook(() => useTypstEquationPreview("(a", true, "light", true));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(result.current).toEqual({ status: "error", message: "unclosed delimiter" });
  });

  it("stays idle while LaTeX mode is active", async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useTypstEquationPreview("x", true, "dark", false));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(result.current.status).toBe("idle");
    expect(mocks.renderTypstSnippet).not.toHaveBeenCalled();
  });

  it.each([
    [
      "a warning when nothing failed outright",
      () => mocks.renderTypstSnippet.mockResolvedValue({ status: "failed", diagnostics: [{ severity: "warning", message: "unused" }] }),
      "q + 1",
      "unused",
    ],
    [
      "nothing when there are no diagnostics",
      () => mocks.renderTypstSnippet.mockResolvedValue({ status: "failed", diagnostics: [] }),
      "q + 2",
      "",
    ],
    [
      "nothing for an image that is not SVG",
      () => mocks.renderTypstSnippet.mockResolvedValue({ status: "rendered", image: { format: "png", pngBase64: "AQID" }, diagnostics: [] }),
      "q + 3",
      "",
    ],
    [
      "the reason Typst could not start",
      () => mocks.renderTypstSnippet.mockRejectedValue(new Error("typst is missing")),
      "q + 4",
      "typst is missing",
    ],
  ])("reports %s", async (_case, arrange, input, message) => {
    vi.useFakeTimers();
    arrange();
    const { result } = renderHook(() => useTypstEquationPreview(input, true, "dark", true));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(result.current).toEqual({ status: "error", message });
  });

  it("falls back to a general message and resets the zoom from its label", () => {
    const onZoomChange = vi.fn();
    render(
      <EquationPreviewPanel
        language="typst"
        typst={{ status: "error", message: "" }}
        input="x"
        onInputChange={onInputChange}
        display
        onDisplayChange={vi.fn()}
        rendered={{ html: "", error: null }}
        wrapped="$ x $"
        previewTheme="light"
        onPreviewThemeChange={vi.fn()}
        zoom={150}
        onZoomChange={onZoomChange}
        editorTheme="oleafly-light"
      />,
    );

    expect(screen.getByText(equation.typstFailed)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "150%" }));
    expect(onZoomChange).toHaveBeenCalledWith(100);
  });
});

