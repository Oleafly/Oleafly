// @vitest-environment jsdom

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import enShell from "@/i18n/locales/en/shell.json" with { type: "json" };

const mocks = vi.hoisted(() => ({ exportCurrentTypst: vi.fn(async () => {}) }));
vi.mock("@/features/export", () => ({ exportCurrentTypst: mocks.exportCurrentTypst }));

import type { TypstOptionsDescriptor } from "@oleafly/backend-port";
import { LATEX_ENGINE } from "@/lib/document-engine";
import { useFilesStore } from "@/store/files";
import { openTypstExport } from "./open";
import { TypstExportDialog, typstExportFormats, typstExportRequest } from "./TypstExportDialog";

const copy = enShell.typstExport;

function options(over: Partial<TypstOptionsDescriptor> = {}): TypstOptionsDescriptor {
  return {
    system_fonts: true,
    reproducible: false,
    variants: [],
    font_dirs: [],
    flags: ["--features", "--pages", "--ppi", "--format"],
    output_formats: ["html", "pdf", "png", "svg"],
    pdf_standards: [],
    ...over,
  };
}

function useTypst(typstOptions: TypstOptionsDescriptor) {
  useFilesStore.setState({
    engine: { ...LATEX_ENGINE, id: "typst", source_format: "typst", typst_options: typstOptions },
  });
}

beforeEach(() => {
  mocks.exportCurrentTypst.mockClear();
});

afterEach(() => {
  useFilesStore.setState({ engine: LATEX_ENGINE });
});

describe("Typst export choices", () => {
  it("offers only what the Typst version can write", () => {
    expect(typstExportFormats(options())).toEqual(["png", "svg", "html"]);
    expect(typstExportFormats(options({ flags: [], output_formats: ["pdf", "png", "svg"] }))).toEqual(["png", "svg"]);
    expect(typstExportFormats(null)).toEqual([]);
  });

  it("builds the request and checks the page range", () => {
    expect(typstExportRequest("png", 300, " 1-2 ", options())).toEqual({ format: "png", ppi: 300, pages: "1-2" });
    expect(typstExportRequest("svg", 300, "", options())).toEqual({ format: "svg" });
    expect(typstExportRequest("html", 144, "1", options())).toEqual({ format: "html" });
    expect(typstExportRequest("svg", 144, "5-1", options())).toBeNull();
    expect(typstExportRequest("svg", 144, "5-1", options({ flags: [] }))).toEqual({ format: "svg" });
  });

  it("exports PNG pages at the chosen resolution", async () => {
    useTypst(options());
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<TypstExportDialog open onClose={onClose} />);
    await waitFor(() => expect(screen.getByTestId("typst-export-png")).toHaveFocus());
    await user.type(screen.getByTestId("typst-export-pages"), "2-3");
    await user.click(screen.getByTestId("typst-export-submit"));
    expect(onClose).toHaveBeenCalledOnce();
    expect(mocks.exportCurrentTypst).toHaveBeenCalledWith({ format: "png", ppi: 144, pages: "2-3" });
  });

  it("refuses a page range Typst would reject", async () => {
    useTypst(options());
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<TypstExportDialog open onClose={onClose} />);
    await waitFor(() => expect(screen.getByTestId("typst-export-png")).toHaveFocus());
    await user.type(screen.getByTestId("typst-export-pages"), "0");
    await user.click(screen.getByTestId("typst-export-submit"));
    expect(screen.getByRole("alert")).toHaveTextContent(copy.pagesInvalid);
    expect(onClose).not.toHaveBeenCalled();
    expect(mocks.exportCurrentTypst).not.toHaveBeenCalled();
  });

  it("marks HTML as experimental and skips pages for it", async () => {
    useTypst(options());
    const user = userEvent.setup();
    render(<TypstExportDialog open onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId("typst-export-png")).toHaveFocus());
    expect(screen.getByText(copy.experimental)).toBeInTheDocument();
    await user.click(screen.getByTestId("typst-export-html"));
    expect(screen.getByText(copy.htmlNote)).toBeInTheDocument();
    expect(screen.queryByTestId("typst-export-pages")).not.toBeInTheDocument();
    await user.click(screen.getByTestId("typst-export-submit"));
    expect(mocks.exportCurrentTypst).toHaveBeenCalledWith({ format: "html" });
  });

  it("says when the version cannot pick pages", () => {
    useTypst(options({ flags: [], output_formats: ["pdf", "png", "svg"] }));
    render(<TypstExportDialog open onClose={vi.fn()} />);
    expect(screen.getByText(copy.pagesUnsupported)).toBeInTheDocument();
    expect(screen.queryByTestId("typst-export-html")).not.toBeInTheDocument();
  });
});

describe("Typst export settings", () => {
  it("exports PNG at another resolution", async () => {
    Element.prototype.hasPointerCapture ??= () => false;
    Element.prototype.releasePointerCapture ??= () => {};
    Element.prototype.scrollIntoView ??= () => {};
    useTypst(options());
    const user = userEvent.setup();
    render(<TypstExportDialog open onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId("typst-export-png")).toHaveFocus());

    await user.click(screen.getByRole("combobox", { name: copy.ppi }));
    await user.click(await screen.findByRole("option", { name: "300 PPI" }));
    await user.click(screen.getByTestId("typst-export-submit"));

    expect(mocks.exportCurrentTypst).toHaveBeenCalledWith({ format: "png", ppi: 300 });
  });

  it("falls back to the first format the version offers", async () => {
    useTypst(options({ output_formats: ["pdf", "svg"] }));
    const user = userEvent.setup();
    render(<TypstExportDialog open onClose={vi.fn()} />);

    await waitFor(() => expect(screen.getByTestId("typst-export-svg")).toBeChecked());
    expect(screen.queryByRole("combobox", { name: copy.ppi })).toBeNull();
    await user.click(screen.getByTestId("typst-export-submit"));
    expect(mocks.exportCurrentTypst).toHaveBeenCalledWith({ format: "svg" });
  });

  it("opens from the menu as a shared dialog and closes from Cancel", async () => {
    useTypst(options());
    const user = userEvent.setup();
    openTypstExport();

    expect(await screen.findByTestId("typst-export-png")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: copy.cancel }));
    await waitFor(() => expect(screen.queryByTestId("typst-export-png")).toBeNull());

    openTypstExport();
    expect(await screen.findByTestId("typst-export-png")).toBeInTheDocument();
    expect(document.querySelectorAll("[data-typst-export]")).toHaveLength(1);
  });
});
