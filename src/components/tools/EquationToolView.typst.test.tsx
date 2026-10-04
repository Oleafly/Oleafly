// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import enResearchTools from "@/i18n/locales/en/researchTools.json" with { type: "json" };
import { useHomeViewStore } from "@/store/home-view";
import { useFilesStore } from "@/store/files";

const mocks = vi.hoisted(() => ({
  renderTypstSnippet: vi.fn(),
  downloadBlob: vi.fn(),
  downloadBytes: vi.fn(),
  panelProps: vi.fn(),
}));

vi.mock("./EquationPreviewPanel", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./EquationPreviewPanel")>()),
  EQUATION_EXAMPLES: [{ id: "fraction", label: () => "Fraction", latex: String.raw`\frac{a}{b}` }],
  EquationPreviewPanel: (props: { input: string; language?: string }) => {
    mocks.panelProps(props);
    return <div data-testid="panel-input" data-language={props.language}>{props.input}</div>;
  },
}));
vi.mock("@/components/ui/popover", () => ({
  Popover: ({ trigger, children }: { trigger: ReactNode; children: ReactNode }) => <div>{trigger}{children}</div>,
  PopoverItem: ({ children, onClick }: { children: ReactNode; onClick: () => void }) => (
    <button type="button" onClick={onClick}>{children}</button>
  ),
}));
vi.mock("@/components/layout/ThemeControls", () => ({ ThemeMenu: () => <div /> }));
vi.mock("@/components/layout/WindowControls", () => ({ WindowControls: () => <div /> }));
vi.mock("@/lib/use-fullscreen", () => ({ useFullscreen: () => false }));
vi.mock("@/lib/download-blob", () => ({ downloadBlob: mocks.downloadBlob, downloadBytes: mocks.downloadBytes }));
vi.mock("@/lib/toast", () => ({
  notifyError: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), successUnique: vi.fn(), errorUnique: vi.fn(), dismiss: vi.fn() },
}));
vi.mock("@/lib/log", () => ({ logError: vi.fn() }));
vi.mock("@/lib/tauri", () => ({
  createImageProject: vi.fn(),
  listFiles: vi.fn(async () => []),
  projectMutationGeneration: vi.fn(async () => 0),
  writeProjectBytes: vi.fn(),
  writeBytesFile: vi.fn(),
  renderTypstSnippet: mocks.renderTypstSnippet,
}));

import { notifyError } from "@/lib/toast";
import { EquationToolView } from "./EquationToolView";

const equation = enResearchTools.equation;
const writeText = vi.fn(async () => {});

beforeEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  useHomeViewStore.setState({ page: "equation" });
  useFilesStore.setState({ projects: [], refreshProjects: vi.fn(async () => undefined) });
  mocks.renderTypstSnippet.mockImplementation(async (request: { format: string }) =>
    request.format === "svg"
      ? { status: "rendered", image: { format: "svg", svg: "<svg>typst</svg>" }, diagnostics: [] }
      : { status: "rendered", image: { format: "png", pngBase64: "AQID" }, diagnostics: [] },
  );
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
});

async function switchToTypst() {
  fireEvent.click(screen.getByRole("button", { name: equation.languageTypst }));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 320));
  });
}

describe("EquationToolView Typst mode", () => {
  it("converts the LaTeX source when switching to Typst and renders it with Typst", async () => {
    render(<EquationToolView />);
    expect(screen.getByTestId("panel-input")).toHaveTextContent(String.raw`\frac{a}{b}`);
    await switchToTypst();
    expect(screen.getByTestId("panel-input")).toHaveTextContent("frac(a, b)");
    expect(screen.getByTestId("panel-input")).toHaveAttribute("data-language", "typst");
    expect(mocks.renderTypstSnippet).toHaveBeenCalledWith({
      source: expect.stringContaining("$ frac(a, b) $"),
      format: "svg",
    });
    expect(screen.getByText(equation.statusRendered)).toBeInTheDocument();
    expect(screen.getByText(equation.subtitleTypst)).toBeInTheDocument();
  });

  it("copies the equation as Typst", async () => {
    render(<EquationToolView />);
    await switchToTypst();
    fireEvent.click(screen.getByRole("button", { name: equation.copyTypst }));
    await act(async () => undefined);
    expect(writeText).toHaveBeenCalledWith("$ frac(a, b) $");
  });

  it("exports SVG and PNG through Typst and hides the KaTeX-only items", async () => {
    render(<EquationToolView />);
    await switchToTypst();
    expect(screen.queryByText(equation.copyMathml)).toBeNull();
    expect(screen.queryByText(equation.copyKatexHtml)).toBeNull();
    expect(screen.queryByText(equation.newImageProject)).toBeNull();

    fireEvent.click(screen.getByText(equation.downloadSvg));
    await act(async () => undefined);
    expect(mocks.renderTypstSnippet).toHaveBeenCalledWith({ source: "$ frac(a, b) $", format: "svg" });
    expect(mocks.downloadBlob).toHaveBeenCalledWith(expect.any(Blob), "equation.svg");

    fireEvent.click(screen.getByText(equation.downloadPng));
    await act(async () => undefined);
    expect(mocks.renderTypstSnippet).toHaveBeenCalledWith(
      expect.objectContaining({ format: "png", source: expect.stringContaining('#set text(fill: rgb("#ffffff"))') }),
    );
    expect(mocks.downloadBytes).toHaveBeenCalledWith(new Uint8Array([1, 2, 3]), "image/png", "equation.png");
  });

  it("keeps each language's source when switching back and forth", async () => {
    render(<EquationToolView />);
    await switchToTypst();
    fireEvent.click(screen.getByRole("button", { name: equation.languageLatex }));
    expect(screen.getByTestId("panel-input")).toHaveTextContent(String.raw`\frac{a}{b}`);
    expect(screen.getByTestId("panel-input")).toHaveAttribute("data-language", "latex");
  });

  it("reports Typst exports that fail with the catalog text", async () => {
    mocks.renderTypstSnippet.mockRejectedValue(new Error("typst crashed"));
    render(<EquationToolView />);
    await switchToTypst();
    vi.mocked(notifyError).mockClear();

    fireEvent.click(screen.getByText(equation.downloadSvg));
    await act(async () => undefined);
    fireEvent.click(screen.getByText(equation.downloadPng));
    await act(async () => undefined);

    expect(notifyError).toHaveBeenCalledWith("equation export svg", expect.any(Error), equation.exportSvgFailed);
    expect(notifyError).toHaveBeenCalledWith("equation export png", expect.any(Error), equation.exportImageFailed);
    expect(mocks.downloadBlob).not.toHaveBeenCalled();
    expect(mocks.downloadBytes).not.toHaveBeenCalled();
  });
});

