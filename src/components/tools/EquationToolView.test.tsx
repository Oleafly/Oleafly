// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const toastSuccess = vi.fn();
const toastError = vi.fn();

vi.mock("@/lib/toast", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
    info: vi.fn(),
    update: vi.fn(),
    dismiss: vi.fn(),
  },
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    isFullscreen: () => Promise.resolve(false),
    isMaximized: () => Promise.resolve(false),
    onResized: () => Promise.resolve(() => {}),
  }),
}));

import enResearchTools from "@/i18n/locales/en/researchTools.json" with { type: "json" };
import { ThemeProvider } from "@/lib/theme";
import { EquationToolView } from "@/components/tools/EquationToolView";
import { EQUATION_EXAMPLES } from "@/components/tools/EquationPreviewPanel";
import { useHomeViewStore } from "@/store/home-view";
import { toolName } from "@/lib/tool-catalog";

const writeText = vi.fn(async () => {});

beforeEach(() => {
  toastSuccess.mockReset();
  toastError.mockReset();
  writeText.mockReset();
  useHomeViewStore.setState({ page: "equation" });
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

function renderView() {
  return render(
    <ThemeProvider>
      <EquationToolView />
    </ThemeProvider>,
  );
}

async function openExportMenu() {
  const trigger = screen.getByRole("button", {
    name: enResearchTools.equation.exportOptions,
  });
  fireEvent.pointerDown(
    trigger,
    new PointerEvent("pointerdown", { bubbles: true, button: 0 }),
  );
  fireEvent.click(trigger);
  await waitFor(() =>
    expect(
      screen.getByRole("button", {
        name: enResearchTools.equation.downloadSvg,
      }),
    ).toBeInTheDocument(),
  );
}

describe("EquationToolView", () => {
  it("renders nothing when another page is active", () => {
    useHomeViewStore.setState({ page: "library" });
    const { container } = renderView();
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the header, the seeded equation and the rendered status", () => {
    renderView();
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

  it("goes back to the library", () => {
    renderView();
    fireEvent.click(screen.getByTestId("equation-tool-view-back"));
    expect(useHomeViewStore.getState().page).toBe("library");
  });

  it("copies the display-wrapped source from the header", () => {
    renderView();
    fireEvent.click(
      screen.getByRole("button", {
        name: enResearchTools.equation.copyLatex,
      }),
    );
    expect(writeText).toHaveBeenCalledWith(
      `\\[ ${EQUATION_EXAMPLES[0].latex} \\]`,
    );
    expect(toastSuccess).toHaveBeenCalledWith(
      enResearchTools.equation.copiedSource,
    );
  });

  it("switches to the error status when the source stops parsing", () => {
    renderView();
    fireEvent.click(
      screen.getByRole("button", {
        name: enResearchTools.equation.example.chemistry,
      }),
    );
    expect(
      screen.getByText(enResearchTools.equation.statusRendered),
    ).toBeInTheDocument();
  });

  it("downloads an SVG from the export menu", async () => {
    renderView();
    await openExportMenu();
    fireEvent.click(
      screen.getByRole("button", {
        name: enResearchTools.equation.downloadSvg,
      }),
    );
    expect(URL.createObjectURL).toHaveBeenCalled();
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalled();
  });

  it("copies KaTeX HTML from the export menu", async () => {
    renderView();
    await openExportMenu();
    fireEvent.click(
      screen.getByRole("button", {
        name: enResearchTools.equation.copyKatexHtml,
      }),
    );
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("katex"));
    expect(toastSuccess).toHaveBeenCalledWith(
      enResearchTools.equation.copiedKatexHtml,
    );
  });

  it("copies MathML from the export menu", async () => {
    renderView();
    await openExportMenu();
    fireEvent.click(
      screen.getByRole("button", {
        name: enResearchTools.equation.copyMathml,
      }),
    );
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("<math"));
    expect(toastSuccess).toHaveBeenCalledWith(
      enResearchTools.equation.copiedMathml,
    );
  });

  it("reports an image export failure when the SVG cannot load", async () => {
    class StubImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      width = 0;
      height = 0;
      set src(_value: string) {
        this.onerror?.();
      }
    }
    const originalImage = globalThis.Image;
    globalThis.Image = StubImage as unknown as typeof Image;
    renderView();
    await openExportMenu();
    fireEvent.click(
      screen.getByRole("button", {
        name: enResearchTools.equation.downloadPng,
      }),
    );
    expect(toastError).toHaveBeenCalledWith(
      enResearchTools.equation.exportImageFailed,
    );
    globalThis.Image = originalImage;
  });

  it("draws and downloads a PNG when the SVG loads", async () => {
    class StubImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      width = 800;
      height = 300;
      set src(_value: string) {
        this.onload?.();
      }
    }
    const originalImage = globalThis.Image;
    globalThis.Image = StubImage as unknown as typeof Image;
    const drawImage = vi.fn();
    HTMLCanvasElement.prototype.getContext = vi.fn(
      () => ({ drawImage }),
    ) as unknown as HTMLCanvasElement["getContext"];
    HTMLCanvasElement.prototype.toDataURL = vi.fn(() => "data:image/png;base64,");
    renderView();
    await openExportMenu();
    fireEvent.click(
      screen.getByRole("button", {
        name: enResearchTools.equation.downloadPng,
      }),
    );
    expect(drawImage).toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
    globalThis.Image = originalImage;
  });
});
