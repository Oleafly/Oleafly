import { describe, expect, it } from "vitest";
import {
  typstFigureMarkup,
  typstLabel,
  typstPreviewOutcome,
  typstPreviewSource,
} from "./typst-figure";

const CETZ = [
  '#import "@preview/cetz:0.4.2"',
  "#cetz.canvas({",
  "  import cetz.draw: *",
  "  circle((0, 0))",
  "})",
].join("\n");

describe("typstPreviewSource", () => {
  it("puts the figure on a white page so the preview image is never transparent", () => {
    const source = typstPreviewSource(CETZ);
    expect(source.split("\n")[0]).toBe("#set page(fill: white, margin: 6pt)");
    expect(source.endsWith(CETZ)).toBe(true);
  });
});

describe("typstPreviewOutcome", () => {
  it("returns the rendered PNG as a data URL and splits errors from warnings", () => {
    const outcome = typstPreviewOutcome({
      ok: true,
      pngBase64: "iVBORw0K",
      diagnostics: [
        { severity: "warning", message: "unknown font family: foo", line: 3, column: 2 },
      ],
    });
    expect(outcome.pngDataUrl).toBe("data:image/png;base64,iVBORw0K");
    expect(outcome.result).toEqual({
      success: true,
      has_image: true,
      errors: [],
      warnings: [{ severity: "warning", message: "unknown font family: foo", line: 2, column: 2 }],
    });
  });

  it("maps diagnostic lines back to the code the model wrote", () => {
    const outcome = typstPreviewOutcome({
      ok: false,
      diagnostics: [
        { severity: "error", message: "unclosed delimiter", line: 5, column: 1 },
        { severity: "error", message: "inside the page setup", line: 1, column: 4 },
        { severity: "error", message: "package not found", line: null, column: null },
      ],
    });
    expect(outcome.pngDataUrl).toBeNull();
    expect(outcome.result).toEqual({
      success: false,
      has_image: false,
      warnings: [],
      errors: [
        { severity: "error", message: "unclosed delimiter", line: 4, column: 1 },
        { severity: "error", message: "inside the page setup", line: null, column: null },
        { severity: "error", message: "package not found", line: null, column: null },
      ],
    });
  });
});

describe("typstLabel", () => {
  it("keeps valid label characters and drops angle brackets", () => {
    expect(typstLabel("fig:transformer")).toBe("fig:transformer");
    expect(typstLabel("<fig:loss-curve.v2>")).toBe("fig:loss-curve.v2");
  });

  it("replaces characters a Typst label cannot hold", () => {
    expect(typstLabel("fig: loss curve!")).toBe("fig:-loss-curve");
    expect(typstLabel("  <>  ")).toBeNull();
  });

  it("strips repeated brackets and dashes from both ends only", () => {
    expect(typstLabel("<<<fig:x>>>")).toBe("fig:x");
    expect(typstLabel(">>a<<")).toBe("a");
    expect(typstLabel("--a  b--")).toBe("a-b");
    expect(typstLabel(`${">".repeat(5000)}a`)).toBe("a");
    expect(typstLabel(`a${"-".repeat(5000)}!`)).toBe("a");
  });
});

describe("typstFigureMarkup", () => {
  it("wraps the code in #figure with a caption and a label", () => {
    expect(
      typstFigureMarkup("#rect(width: 2cm)[A]", { caption: "A box", label: "fig:box" }),
    ).toBe("#figure(caption: [A box])[\n  #rect(width: 2cm)[A]\n] <fig:box>");
  });

  it("leaves out the caption and label when none are given", () => {
    expect(typstFigureMarkup("  #circle(radius: 1cm)\n", {})).toBe(
      "#figure[\n  #circle(radius: 1cm)\n]",
    );
  });

  it("lifts leading imports above the figure", () => {
    expect(typstFigureMarkup(CETZ, { caption: "Unit circle", label: "fig:circle" })).toBe(
      [
        '#import "@preview/cetz:0.4.2"',
        "#figure(caption: [Unit circle])[",
        "  #cetz.canvas({",
        "    import cetz.draw: *",
        "    circle((0, 0))",
        "  })",
        "] <fig:circle>",
      ].join("\n"),
    );
  });

  it("skips an import the document already has", () => {
    const existing = '#import "@preview/cetz:0.4.2"\n\n= Results\n';
    expect(typstFigureMarkup(CETZ, { existingSource: existing })).toBe(
      "#figure[\n  #cetz.canvas({\n    import cetz.draw: *\n    circle((0, 0))\n  })\n]",
    );
  });

  it("keeps a multi-line import inside the body", () => {
    const code = '#import "@preview/fletcher:0.5.8": (\n  diagram, node)\n#diagram(node((0, 0), [A]))';
    expect(typstFigureMarkup(code, { raw: true })).toBe(code);
  });

  it("inserts the bare code in raw mode, imports first", () => {
    expect(typstFigureMarkup(CETZ, { raw: true, caption: "ignored", label: "fig:x" })).toBe(CETZ);
  });

  it("keeps blank lines inside the body unindented", () => {
    expect(typstFigureMarkup("#let a = 1\n\n#a", {})).toBe("#figure[\n  #let a = 1\n\n  #a\n]");
  });
});
