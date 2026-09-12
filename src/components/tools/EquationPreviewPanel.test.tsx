// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

const toastSuccess = vi.fn();

vi.mock("@/lib/toast", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: vi.fn(),
    info: vi.fn(),
    update: vi.fn(),
    dismiss: vi.fn(),
  },
}));

import enCommon from "@/i18n/locales/en/common.json" with { type: "json" };
import enResearchTools from "@/i18n/locales/en/researchTools.json" with { type: "json" };
import {
  EQUATION_EXAMPLES,
  EquationPreviewPanel,
  renderEquation,
} from "@/components/tools/EquationPreviewPanel";

const writeText = vi.fn(async () => {});

interface PanelOverrides {
  input?: string;
  display?: boolean;
  previewTheme?: "light" | "dark";
  zoom?: number;
}

const onInputChange = vi.fn();
const onDisplayChange = vi.fn();
const onPreviewThemeChange = vi.fn();
const onZoomChange = vi.fn();

function renderPanel(overrides: PanelOverrides = {}) {
  const input = overrides.input ?? EQUATION_EXAMPLES[0].latex;
  const display = overrides.display ?? true;
  const rendered = renderEquation(input, display);
  return render(
    <EquationPreviewPanel
      input={input}
      onInputChange={onInputChange}
      display={display}
      onDisplayChange={onDisplayChange}
      rendered={rendered}
      wrapped={display ? `\\[ ${input} \\]` : `$${input}$`}
      previewTheme={overrides.previewTheme ?? "dark"}
      onPreviewThemeChange={onPreviewThemeChange}
      zoom={overrides.zoom ?? 100}
      onZoomChange={onZoomChange}
      editorTheme="oleafly-dark"
    />,
  );
}

beforeEach(() => {
  toastSuccess.mockReset();
  writeText.mockReset();
  onInputChange.mockReset();
  onDisplayChange.mockReset();
  onPreviewThemeChange.mockReset();
  onZoomChange.mockReset();
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
});

describe("renderEquation", () => {
  it("returns empty output for blank input", () => {
    expect(renderEquation("   ", true)).toEqual({ html: "", error: null });
  });

  it("renders every catalog example without error", () => {
    for (const example of EQUATION_EXAMPLES) {
      const result = renderEquation(example.latex, true);
      expect(result.error).toBeNull();
      expect(result.html.length).toBeGreaterThan(0);
      expect(example.label().length).toBeGreaterThan(0);
    }
  });

  it("reports a KaTeX error for malformed input", () => {
    const result = renderEquation("\\frac{", true);
    expect(result.html).toBe("");
    expect(result.error).toBeTruthy();
  });
});

describe("EquationPreviewPanel", () => {
  it("renders the source and preview headings with the display badge", () => {
    renderPanel();
    expect(
      screen.getByText(enResearchTools.equation.sourceHeading),
    ).toBeInTheDocument();
    expect(
      screen.getByText(enResearchTools.equation.previewHeading),
    ).toBeInTheDocument();
    expect(
      screen.getAllByText(enResearchTools.equation.display).length,
    ).toBeGreaterThan(1);
    expect(screen.getByTestId("equation-latex-field")).toBeInTheDocument();
  });

  it("shows the empty hint when there is nothing to render", () => {
    renderPanel({ input: "" });
    expect(
      screen.getByText(enResearchTools.equation.empty),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: enCommon.actions.copy }),
    ).not.toBeInTheDocument();
  });

  it("shows the KaTeX message when the source does not parse", () => {
    renderPanel({ input: "\\frac{" });
    expect(
      screen.queryByText(enResearchTools.equation.empty),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/KaTeX/)).toBeInTheDocument();
  });

  it("renders the inline sample sentence in inline mode", () => {
    renderPanel({ display: false });
    expect(screen.getByText(/flowing with the surrounding text/)).toBeInTheDocument();
  });

  it("toggles inline and display through the segmented control", () => {
    renderPanel({ display: true });
    fireEvent.click(
      screen.getByRole("button", { name: enResearchTools.equation.inline }),
    );
    expect(onDisplayChange).toHaveBeenCalledWith(false);
    fireEvent.click(
      screen.getAllByRole("button", {
        name: enResearchTools.equation.display,
      })[0],
    );
    expect(onDisplayChange).toHaveBeenCalledWith(true);
  });

  it("loads an example into the source field", () => {
    renderPanel();
    fireEvent.click(
      screen.getByRole("button", {
        name: enResearchTools.equation.example.chemistry,
      }),
    );
    expect(onInputChange).toHaveBeenCalledWith(
      EQUATION_EXAMPLES.at(-1)?.latex,
    );
  });

  it("copies the wrapped source from the preview card", () => {
    renderPanel({ display: false, input: "x^2" });
    fireEvent.click(
      screen.getByRole("button", { name: enCommon.actions.copy }),
    );
    expect(writeText).toHaveBeenCalledWith("$x^2$");
    expect(toastSuccess).toHaveBeenCalledWith(
      enResearchTools.equation.copiedSource,
    );
  });

  it("switches the preview backdrop", () => {
    renderPanel({ previewTheme: "dark" });
    fireEvent.click(
      screen.getByRole("button", {
        name: enResearchTools.equation.previewLight,
      }),
    );
    expect(onPreviewThemeChange).toHaveBeenCalledWith("light");
    fireEvent.click(
      screen.getByRole("button", {
        name: enResearchTools.equation.previewDark,
      }),
    );
    expect(onPreviewThemeChange).toHaveBeenCalledWith("dark");
  });

  it("clamps zoom at both ends and resets it", () => {
    renderPanel({ zoom: 25 });
    fireEvent.click(
      screen.getByRole("button", { name: enResearchTools.equation.zoomOut }),
    );
    expect(onZoomChange).toHaveBeenLastCalledWith(25);
    fireEvent.click(
      screen.getByRole("button", { name: enResearchTools.equation.zoomIn }),
    );
    expect(onZoomChange).toHaveBeenLastCalledWith(50);
    fireEvent.click(
      screen.getByRole("button", { name: enResearchTools.equation.resetZoom }),
    );
    expect(onZoomChange).toHaveBeenLastCalledWith(100);
  });

  it("does not raise the zoom past its ceiling", () => {
    renderPanel({ zoom: 400 });
    fireEvent.click(
      screen.getByRole("button", { name: enResearchTools.equation.zoomIn }),
    );
    expect(onZoomChange).toHaveBeenLastCalledWith(400);
  });

  it("requests and exits fullscreen on the preview card", () => {
    const requestFullscreen = vi.fn(async () => {});
    const exitFullscreen = vi.fn(async () => {});
    Element.prototype.requestFullscreen = requestFullscreen;
    Object.defineProperty(document, "exitFullscreen", {
      configurable: true,
      value: exitFullscreen,
    });
    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      value: null,
    });
    renderPanel();
    const button = screen.getByRole("button", {
      name: enResearchTools.equation.fullscreen,
    });
    fireEvent.click(button);
    expect(requestFullscreen).toHaveBeenCalled();

    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      value: document.body,
    });
    fireEvent.click(button);
    expect(exitFullscreen).toHaveBeenCalled();
  });
});
