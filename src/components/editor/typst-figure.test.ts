import { beforeEach, describe, expect, it, vi } from "vitest";

const controller = vi.hoisted(() => ({
  insertTemplate: vi.fn(),
  replaceRange: vi.fn(),
}));

vi.mock("@/components/editor/cm/controller", () => controller);

import {
  applyTypstFigureEdit,
  insertTypstFigureFromDialog,
  projectPathForTypstReference,
  typstCaptionContent,
  typstFigureAt,
  typstFigurePlaceholder,
  typstFigureSource,
  typstImageReference,
  type TypstFigureFields,
} from "./typst-figure";

const BASE: TypstFigureFields = {
  path: "figures/plot.png",
  width: "80%",
  caption: "A plot",
  label: "fig:plot",
  alt: null,
  placement: "none",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("typstFigureSource", () => {
  it("writes an image figure with width, caption and label", () => {
    const snippet = typstFigureSource(BASE, "0.15.1");
    expect(snippet.template).toBe(
      ['#figure(', '  image("figures/plot.png", width: 80%),', "  caption: [A plot],", ") <fig:plot>"].join("\n"),
    );
    expect(snippet.template.slice(snippet.selStart, snippet.selEnd)).toBe("A plot");
  });

  it("puts alt text on the image and writes the placement", () => {
    const snippet = typstFigureSource({ ...BASE, alt: 'A "red" square', placement: "top" }, "0.15.1");
    expect(snippet.template).toBe(
      [
        "#figure(",
        '  image("figures/plot.png", width: 80%, alt: "A \\"red\\" square"),',
        "  placement: top,",
        "  caption: [A plot],",
        ") <fig:plot>",
      ].join("\n"),
    );
  });

  it("keeps figure-level alt text only where the Typst version supports it", () => {
    const fields = { ...BASE, alt: "Chart", figureAlt: true };
    expect(typstFigureSource(fields, "0.14.0").template).toContain('  alt: "Chart",');
    expect(typstFigureSource(fields, "0.14.0").template).toContain('image("figures/plot.png", width: 80%),');
    const old = typstFigureSource(fields, "0.13.1").template;
    expect(old).toContain('image("figures/plot.png", width: 80%, alt: "Chart"),');
    expect(old).not.toContain('  alt: "Chart",');
  });

  it("omits the caption and label when they are off", () => {
    const snippet = typstFigureSource({ ...BASE, width: null, caption: null, label: null }, null);
    expect(snippet.template).toBe('#figure(\n  image("figures/plot.png"),\n)');
    expect(snippet.selStart).toBe(snippet.template.length);
    expect(snippet.selEnd).toBe(snippet.template.length);
  });

  it("escapes caption brackets only when they are unbalanced", () => {
    expect(typstCaptionContent("Fit [see #ref(<a>)]")).toBe("Fit [see #ref(<a>)]");
    expect(typstCaptionContent("Range [0, 1")).toBe(String.raw`Range \[0, 1`);
    expect(typstCaptionContent("line\nbreak")).toBe("line break");
  });

  it("repairs labels that Typst would reject", () => {
    expect(typstFigureSource({ ...BASE, label: "fig plot!" }, null).template).toMatch(/\) <fig-plot->$/u);
  });

  it("selects the image path in the placeholder", () => {
    const snippet = typstFigurePlaceholder();
    expect(snippet.template).toBe(
      '#figure(\n  image("image-filename", width: 80%),\n  caption: [Caption text],\n) <fig:label>\n',
    );
    expect(snippet.template.slice(snippet.selStart, snippet.selEnd)).toBe("image-filename");
  });
});

describe("typstFigureAt", () => {
  const SOURCE = [
    "= Results",
    "",
    "#figure(",
    '  image("figures/plot.png", width: 50%, alt: "Growth"),',
    "  placement: auto,",
    "  caption: [Growth over [two] years],",
    ") <fig:plot>",
    "",
    "Text after.",
  ].join("\n");

  it("finds the figure around the cursor with every field", () => {
    const at = SOURCE.indexOf("width");
    const match = typstFigureAt(SOURCE, at);
    expect(match).not.toBeNull();
    expect(SOURCE.slice(match?.from, match?.to)).toBe(SOURCE.slice(SOURCE.indexOf("#figure"), SOURCE.indexOf("<fig:plot>") + 10));
    expect(match?.body).toBe("image");
    expect(match?.label).toBe("fig:plot");
    expect(match?.fields).toEqual({
      path: "figures/plot.png",
      width: "50%",
      caption: "Growth over [two] years",
      label: "fig:plot",
      alt: "Growth",
      placement: "auto",
    });
  });

  it("ignores positions outside the figure", () => {
    expect(typstFigureAt(SOURCE, 2)).toBeNull();
    expect(typstFigureAt(SOURCE, SOURCE.indexOf("Text after"))).toBeNull();
  });

  it("round-trips a figure through parse and format", () => {
    const match = typstFigureAt(SOURCE, SOURCE.indexOf("caption"));
    if (!match?.fields) throw new Error("figure not parsed");
    const written = typstFigureSource(match.fields, "0.15.1").template;
    expect(written).toBe(SOURCE.slice(match.from, match.to));
    const again = typstFigureAt(written, 5);
    expect(again?.fields).toEqual(match.fields);
  });

  it("keeps arguments the dialog does not edit", () => {
    const source =
      '#figure(image("a.png", height: 3cm, fit: "contain"), kind: image, supplement: [Fig.], caption: [A]) <fig:a>';
    const match = typstFigureAt(source, 10);
    if (!match?.fields) throw new Error("figure not parsed");
    expect(match.fields.imageArgs).toEqual([
      { name: "height", text: "height: 3cm" },
      { name: "fit", text: 'fit: "contain"' },
    ]);
    const edited = typstFigureSource({ ...match.fields, width: "40%", caption: "B" }, null).template;
    expect(edited).toBe(
      [
        "#figure(",
        '  image("a.png", width: 40%, height: 3cm, fit: "contain"),',
        "  kind: image,",
        "  supplement: [Fig.],",
        "  caption: [B],",
        ") <fig:a>",
      ].join("\n"),
    );
    expect(typstFigureAt(edited, 3)?.fields).toEqual({ ...match.fields, width: "40%", caption: "B" });
  });

  it("reads figure-level alt text and strings that contain brackets", () => {
    const source = '#figure(image("x).png"), alt: "A ) tricky [alt]", caption: [Cap])';
    const match = typstFigureAt(source, source.length - 2);
    expect(match?.fields).toMatchObject({ path: "x).png", alt: "A ) tricky [alt]", figureAlt: true, caption: "Cap" });
    expect(match?.to).toBe(source.length);
  });

  it("finds figures written in code mode and skips comments", () => {
    const source = '#let f = figure(image("b.png"), caption: [B]) // figure(image("c.png"))';
    const match = typstFigureAt(source, source.indexOf("b.png"));
    expect(match?.fields?.path).toBe("b.png");
    expect(match?.from).toBe(source.indexOf("figure("));
  });

  it("reports table figures without editable fields", () => {
    const source = "#figure(\n  table(columns: 2, [a], [b]),\n  caption: [T],\n)";
    const match = typstFigureAt(source, source.indexOf("[a]"));
    expect(match?.body).toBe("table");
    expect(match?.fields).toBeNull();
    expect(match?.label).toBeNull();
  });

  it("does not edit an image that is not a plain string path", () => {
    const source = "#figure(image(path), caption: [A])";
    expect(typstFigureAt(source, 12)?.fields).toBeNull();
  });
});

describe("typst figure paths and insertion", () => {
  it("writes image paths relative to the file and resolves them back", () => {
    expect(typstImageReference("figures/plot.png", "main.typ")).toBe("figures/plot.png");
    expect(typstImageReference("figures/plot.png", "chapters/one.typ")).toBe("../figures/plot.png");
    expect(projectPathForTypstReference("../figures/plot.png", "chapters/one.typ")).toBe("figures/plot.png");
    expect(projectPathForTypstReference("/figures/plot.png", "chapters/one.typ")).toBe("figures/plot.png");
    expect(projectPathForTypstReference("./a.png", "chapters/one.typ")).toBe("chapters/a.png");
  });

  it("inserts a dialog figure relative to the active file with the caption selected", () => {
    insertTypstFigureFromDialog(
      { path: "figures/plot.png", width: "50%", caption: "Plot", label: "fig:plot", alt: "Bars", placement: "bottom" },
      "chapters/one.typ",
      "0.15.1",
    );
    const template = [
      "#figure(",
      '  image("../figures/plot.png", width: 50%, alt: "Bars"),',
      "  placement: bottom,",
      "  caption: [Plot],",
      ") <fig:plot>",
      "",
    ].join("\n");
    const start = template.indexOf("Plot]");
    expect(controller.insertTemplate).toHaveBeenCalledWith(template, start, start + 4);
  });

  it("replaces the edited range with the rewritten figure", () => {
    applyTypstFigureEdit({ from: 3, to: 40 }, { ...BASE, caption: null, label: null }, null);
    expect(controller.replaceRange).toHaveBeenCalledWith(
      3,
      40,
      '#figure(\n  image("figures/plot.png", width: 80%),\n)',
    );
  });
});
