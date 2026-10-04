// @vitest-environment jsdom

import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TypstOptionsDescriptor } from "@oleafly/backend-port";
import enPreflight from "@/i18n/locales/en/preflight.json" with { type: "json" };
import enShell from "@/i18n/locales/en/shell.json" with { type: "json" };

const mocks = vi.hoisted(() => ({
  isTauri: vi.fn(() => false),
  compileTaggedAndVerify: vi.fn(async () => {}),
  toastError: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tauri-apps/api/core")>()),
  isTauri: () => mocks.isTauri(),
}));
vi.mock("@/features/latex-engine", () => ({
  compileTaggedAndVerify: mocks.compileTaggedAndVerify,
}));
vi.mock("@/lib/toast", () => ({ toast: { error: mocks.toastError } }));

import { LATEX_ENGINE } from "@/lib/document-engine";
import { useEngineStore } from "@/store/engine";
import { useFilesStore } from "@/store/files";
import { useFolderAccessStore } from "@/store/folder-access";
import { usePreflightStore } from "@/store/preflight";
import { PrepExport } from "./PrepExport";

const copy = enPreflight.prepExport;
const article = "\\documentclass{article}\n\\begin{document}\nHello\n\\end{document}\n";

function openLatex(files: Record<string, string>, activePath = "main.tex", mainDoc = "main.tex") {
  useFilesStore.setState({
    projectId: "project",
    mainDoc,
    activePath,
    engine: LATEX_ENGINE,
    engineLoaded: true,
    files: Object.fromEntries(
      Object.entries(files).map(([path, content]) => [path, { content, dirty: false }]),
    ),
  });
}

const runPreflight = vi.fn(async () => {});
const ensureLoaded = vi.fn(async () => {});

beforeEach(() => {
  mocks.isTauri.mockReturnValue(false);
  mocks.compileTaggedAndVerify.mockClear();
  mocks.toastError.mockClear();
  runPreflight.mockClear();
  ensureLoaded.mockClear();
  usePreflightStore.setState({ run: runPreflight });
  useEngineStore.setState({ info: null, ensureLoaded });
  useFolderAccessStore.setState({ projectId: null, status: null } as never);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn(async () => {}) },
  });
});

afterEach(() => {
  useFilesStore.setState({ files: {}, activePath: null, mainDoc: "" });
});

describe("accessible export preparation", () => {
  it("prepares the document, applies it and re-runs preflight", async () => {
    openLatex({ "main.tex": article });
    render(<PrepExport />);

    expect(screen.getByText(copy.title)).toBeInTheDocument();
    expect(screen.queryByText(copy.activeFileFallback)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: copy.prepare }));

    expect(screen.getAllByRole("listitem").length).toBeGreaterThan(0);
    expect(screen.getByText(copy.noEngine)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: copy.apply }));

    expect(useFilesStore.getState().files["main.tex"].content).toContain("\\DocumentMetadata");
    expect(screen.getByRole("button", { name: copy.applied })).toBeDisabled();
    expect(runPreflight).toHaveBeenCalledTimes(1);
  });

  it("copies the prepared source", async () => {
    openLatex({ "main.tex": article });
    render(<PrepExport />);
    fireEvent.click(screen.getByRole("button", { name: copy.prepare }));

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: copy.copy }));
    });

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining("\\DocumentMetadata"),
    );
    expect(screen.getByRole("button", { name: copy.copied })).toBeInTheDocument();
    expect(useFilesStore.getState().files["main.tex"].content).toBe(article);
  });

  it("offers a tagged compile when a system engine is available", () => {
    mocks.isTauri.mockReturnValue(true);
    useEngineStore.setState({
      info: { kind: "system", lualatex: "/usr/bin/lualatex", tlmgr: null, version: "2025", latexmk: null },
    });
    openLatex({ "main.tex": article });
    render(<PrepExport />);
    expect(ensureLoaded).toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: copy.prepare }));
    fireEvent.click(screen.getByRole("button", { name: copy.compileTagged }));

    expect(mocks.compileTaggedAndVerify).toHaveBeenCalledTimes(1);
    expect(screen.getByText(copy.compileTaggedWarning)).toBeInTheDocument();
    expect(screen.queryByText(copy.noEngine)).toBeNull();
  });

  it("refuses to apply to a read-only folder", () => {
    openLatex({ "main.tex": article });
    useFolderAccessStore.setState({ projectId: "project", status: { read_only: true } } as never);
    render(<PrepExport />);

    fireEvent.click(screen.getByRole("button", { name: copy.prepare }));
    fireEvent.click(screen.getByRole("button", { name: copy.apply }));

    expect(mocks.toastError).toHaveBeenCalledWith(enShell.openedFolder.readOnly.banner);
    expect(useFilesStore.getState().files["main.tex"].content).toBe(article);
    expect(runPreflight).not.toHaveBeenCalled();
  });

  it("explains why preparation is off for a class that cannot be tagged", () => {
    openLatex({ "main.tex": "\\documentclass{IEEEtran}\n\\begin{document}x\\end{document}" });
    render(<PrepExport />);

    expect(screen.queryByRole("button", { name: copy.prepare })).toBeNull();
    expect(
      screen.getByText((text) => text.startsWith("Preparation is off for this document class.")),
    ).toBeInTheDocument();
    expect(screen.getByText(/IEEEtran/)).toBeInTheDocument();
  });

  it("lists partly tagging packages as cautions", () => {
    openLatex({
      "main.tex": "\\documentclass{acmart}\n\\usepackage{enumitem}\n\\usepackage{amsmath}\n\\begin{document}x\\end{document}",
    });
    render(<PrepExport />);

    expect(screen.getByText(/acmart/)).toBeInTheDocument();
    expect(screen.getByText(/enumitem/)).toBeInTheDocument();
    expect(screen.getByText(/amsmath/)).toBeInTheDocument();
  });

  it("checks the file being edited when the main document is not loaded", () => {
    openLatex({ "chapter.tex": article }, "chapter.tex", "main.tex");
    render(<PrepExport />);

    expect(screen.getByText(copy.activeFileFallback)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: copy.prepare })).toBeEnabled();
  });

  it("shows the Typst PDF standards for a Typst project and nothing for other engines", () => {
    const typstOptions: TypstOptionsDescriptor = {
      system_fonts: true,
      reproducible: false,
      variants: [],
      font_dirs: [],
      flags: [],
      output_formats: ["pdf"],
      pdf_standards: ["a-2b"],
    };
    useFilesStore.setState({
      activePath: "main.typ",
      engineLoaded: true,
      engine: {
        ...LATEX_ENGINE,
        id: "typst",
        source_format: "typst",
        typst_options: typstOptions,
        typst_resolved: { version: "0.14.2" },
        capabilities: { ...LATEX_ENGINE.capabilities, source_preflight_profile: "none" },
      } as never,
    });
    const { unmount } = render(<PrepExport />);
    expect(screen.getByTestId("typst-pdf-standards")).toBeInTheDocument();
    unmount();

    useFilesStore.setState({
      engine: {
        ...LATEX_ENGINE,
        id: "markdown",
        source_format: "markdown",
        capabilities: { ...LATEX_ENGINE.capabilities, source_preflight_profile: "none" },
      } as never,
    });
    const { container } = render(<PrepExport />);
    expect(container).toBeEmptyDOMElement();
  });
});
