// @vitest-environment jsdom

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FileBadge, FileIcon, FolderIcon, fileBadgeLabel, fileGlyphKind } from "./fileIcon";

describe("fileGlyphKind", () => {
  it.each([
    ["main.tex", "tex"],
    ["chapters/Intro.TEX", "tex"],
    ["neurips.sty", "style"],
    ["paper.typ", "typst"],
    ["references.bib", "bib"],
    ["notes.md", "markdown"],
    ["figures/plot.pdf", "pdf"],
    ["figures/plot.png", "image"],
    ["results.csv", "sheet"],
    ["figures/architecture.excalidraw", "board"],
    ["slides/talk/index.tsx", "slides"],
    ["src/index.tsx", "code"],
    ["attention-demo.html", "code"],
    ["project.toml", "config"],
    ["data.tar", "archive"],
    ["main.synctex.gz", "tex"],
    [".gitignore", "git"],
    ["Makefile", "code"],
    ["LICENSE", "text"],
    ["README", "text"],
    ["notes.unknown", "text"],
  ])("gives %s the %s glyph", (name, kind) => {
    expect(fileGlyphKind(name)).toBe(kind);
  });
});

describe("FileIcon", () => {
  it("strokes the glyph in its kind's hue and tints its body", () => {
    const { container } = render(<FileIcon name="main.tex" className="size-4" />);
    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("data-file-kind", "tex");
    expect(svg).toHaveClass("size-4", "text-file-source", "[&>:first-child]:fill-current/15");
  });

  it("tints a book's cover, which Lucide draws after its ribbon", () => {
    const { container } = render(<FileIcon name="references.bib" />);
    expect(container.querySelector("svg")).toHaveClass("text-file-prose", "[&>:nth-child(2)]:fill-current/15");
  });

  it("fills every shape of a whiteboard glyph", () => {
    const { container } = render(<FileIcon name="sketch.excalidraw" />);
    expect(container.querySelector("svg")).toHaveClass("text-file-image", "[&>*]:fill-current/15");
  });

  it.each([
    ["main.tex", "text-file-source"],
    ["neurips.sty", "text-file-source"],
    ["latexmk.json", "text-file-source"],
    ["paper.typ", "text-file-typst"],
    ["notes.md", "text-file-prose"],
    ["references.bib", "text-file-prose"],
    ["figures/plot.pdf", "text-file-pdf"],
    ["figures/plot.png", "text-file-image"],
    ["results.csv", "text-file-sheet"],
    ["analysis.py", "text-file-code"],
    ["slides/talk/index.tsx", "text-file-code"],
    ["data.zip", "text-file-folder"],
    ["readings.dat", "text-muted-foreground"],
  ])("colours %s with %s", (name, hue) => {
    const { container } = render(<FileIcon name={name} />);
    expect(container.querySelector("svg")).toHaveClass(hue);
  });
});

describe("fileBadgeLabel", () => {
  it.each([
    ["main.tex", "TEX"],
    ["figures/Plot.PNG", "PNG"],
    ["analysis.ipynb", "IPYNB"],
    ["main.synctex.gz", "GZ"],
    ["sketch.excalidraw", "DRAW"],
    ["notes.markdown", "MD"],
    ["slides/talk/index.tsx", "DECK"],
    ["readings.dat", "DAT"],
    [".gitignore", null],
    ["Makefile", null],
    ["archive.tar-split", null],
  ])("labels %s as %s", (name, label) => {
    expect(fileBadgeLabel(name)).toBe(label);
  });
});

describe("FileBadge", () => {
  it("writes the type in its kind's colour on a tint of it", () => {
    const { getByText } = render(<FileBadge name="figures/plot.pdf" />);
    expect(getByText("PDF")).toHaveClass("text-file-pdf", "bg-current/15");
    expect(getByText("PDF")).toHaveAttribute("data-file-kind", "pdf");
  });

  it("falls back to the icon, in the badge's width, for a file with no type to name", () => {
    const { container } = render(<FileBadge name=".gitignore" />);
    expect(container.firstElementChild).toHaveClass("w-8.5");
    expect(container.querySelector("svg")).toHaveAttribute("data-file-kind", "git");
  });
});

describe("FolderIcon", () => {
  it("draws an open or closed folder in the folder hue", () => {
    const { container, rerender } = render(<FolderIcon open={false} />);
    const closed = container.querySelector("svg")?.innerHTML;
    expect(container.querySelector("svg")).toHaveClass("text-file-folder");
    rerender(<FolderIcon open />);
    expect(container.querySelector("svg")?.innerHTML).not.toBe(closed);
  });
});
