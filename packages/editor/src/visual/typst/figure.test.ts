import { beforeAll, describe, expect, it } from "vitest";
import { loadTypstParser } from "../../typst";
import { installEnglishEditorMessages } from "../../test-messages";
import { type GraphicsOptions, GraphicsWidget } from "../widgets/graphics";
import { IconBraceWidget } from "../widgets/icon-brace";
import { TypstTableWidget } from "./table/widget";
import { hiddenRanges, lineClassesAt, rangeOf, typstState, widgetsOf } from "./test-support";

beforeAll(async () => {
  installEnglishEditorMessages();
  await loadTypstParser();
});

function optionsOf(widget: GraphicsWidget): GraphicsOptions {
  return (widget as unknown as { options: GraphicsOptions }).options;
}

function lineOf(doc: string, needle: string): { from: number; to: number } {
  const at = doc.indexOf(needle);
  const from = doc.lastIndexOf("\n", at) + 1;
  const end = doc.indexOf("\n", at);
  return { from, to: end === -1 ? doc.length : end };
}

const IMAGE_FIGURE = `Intro.
#figure(
  image("plot.png", width: 80%),
  caption: [Plot *caption*],
) <fig:plot>
After.`;

describe("Typst figures with images", () => {
  it("renders the image in place, hides the call and keeps the caption", () => {
    const doc = IMAGE_FIGURE;
    const state = typstState(doc, { cursor: doc.length });
    const [image] = widgetsOf(state, GraphicsWidget);
    const imageLine = lineOf(doc, "image(");
    expect([image.from, image.to, image.block]).toEqual([imageLine.from, imageLine.to, true]);
    const options = optionsOf(image.widget);
    expect(options.path).toBe("plot.png");
    expect(options.centered).toBe(true);
    expect(options.range).toEqual({ from: doc.indexOf("#figure"), to: rangeOf(doc, "<fig:plot>").to });

    const hidden = hiddenRanges(state);
    const open = lineOf(doc, "#figure(");
    expect(hidden).toContainEqual({ from: open.from, to: open.to, block: true });
    const captionLine = lineOf(doc, "caption:");
    const caption = rangeOf(doc, "Plot *caption*");
    expect(hidden).toContainEqual({ from: captionLine.from, to: caption.from, block: false });
    expect(hidden).toContainEqual({ from: caption.to, to: captionLine.to, block: false });
    const close = rangeOf(doc, ") <fig");
    expect(hidden).toContainEqual({ from: close.from, to: close.from + 1, block: false });

    const label = widgetsOf(state, IconBraceWidget).find((found) => found.from === rangeOf(doc, "<fig:plot>").from);
    expect(label?.widget.icon).toBe("tag");
  });

  it("styles every line of the figure as a panel", () => {
    const state = typstState(IMAGE_FIGURE, { cursor: 0 });
    expect(lineClassesAt(state, IMAGE_FIGURE.indexOf("#figure"))).toEqual(
      expect.arrayContaining(["ofl-visual-typst-figure-line", "ofl-visual-typst-figure-first-line"]),
    );
    expect(lineClassesAt(state, IMAGE_FIGURE.indexOf(") <fig"))).toEqual(
      expect.arrayContaining(["ofl-visual-typst-figure-line", "ofl-visual-typst-figure-last-line"]),
    );
    expect(lineClassesAt(state, 0)).not.toContain("ofl-visual-typst-figure-line");
  });

  it("keeps the figure rendered while the cursor edits the caption", () => {
    const at = rangeOf(IMAGE_FIGURE, "Plot").to;
    expect(widgetsOf(typstState(IMAGE_FIGURE, { cursor: at }), GraphicsWidget)).toHaveLength(1);
  });

  it("reveals the whole figure when the cursor reaches its code", () => {
    const state = typstState(IMAGE_FIGURE, { cursor: IMAGE_FIGURE.indexOf("#figure") });
    expect(widgetsOf(state, GraphicsWidget)).toEqual([]);
    const caption = lineOf(IMAGE_FIGURE, "caption:");
    expect(hiddenRanges(state).filter((range) => range.block || range.from === caption.from)).toEqual([]);
  });

  it("renders a one-line figure inline", () => {
    const doc = 'Text #figure(image("a.png"), caption: [A]) end.';
    const state = typstState(doc, { cursor: 0 });
    const [image] = widgetsOf(state, GraphicsWidget);
    const call = rangeOf(doc, 'image("a.png")');
    expect([image.from, image.to, image.block]).toEqual([call.from, call.to, false]);
    expect(hiddenRanges(state)).toEqual([
      { from: doc.indexOf("#figure"), to: call.from, block: false },
      { from: call.to, to: rangeOf(doc, "[A]").from + 1, block: false },
      { from: rangeOf(doc, "[A]").to - 1, to: rangeOf(doc, ") end").from + 1, block: false },
    ]);
  });
});

describe("Typst figures with other bodies", () => {
  it("renders a table body as an editable grid", () => {
    const doc = `#figure(
  table(
    columns: 2,
    [a], [b],
  ),
  caption: [Numbers],
)
Next.`;
    const state = typstState(doc, { cursor: doc.length });
    const [grid] = widgetsOf(state, TypstTableWidget);
    const first = lineOf(doc, "  table(");
    const last = lineOf(doc, "  ),");
    expect([grid.from, grid.to, grid.block]).toEqual([first.from, last.to, true]);
    expect(grid.widget.removal).toEqual({ from: 0, to: doc.indexOf("\nNext") });
  });

  it("shows the content of a content-block body", () => {
    const doc = "#figure([Body text], caption: [Cap])\nNext.";
    const state = typstState(doc, { cursor: doc.length });
    expect(hiddenRanges(state)).toEqual([
      { from: 0, to: rangeOf(doc, "Body").from, block: false },
      { from: rangeOf(doc, "text]").from + 4, to: rangeOf(doc, "Cap").from, block: false },
      { from: rangeOf(doc, "Cap").to, to: doc.indexOf("\nNext"), block: false },
    ]);
  });

  it("leaves figures it cannot model as source", () => {
    const doc = "#figure(rect(width: 1cm), caption: [Shape])\nNext.";
    const state = typstState(doc, { cursor: doc.length });
    expect(hiddenRanges(state)).toEqual([]);
    expect(lineClassesAt(state, 0)).toContain("ofl-visual-typst-figure-line");
  });

  it("shows a trailing content-block body", () => {
    const doc = "#figure(caption: [Cap])[Body]\nNext.";
    const state = typstState(doc, { cursor: doc.length });
    expect(hiddenRanges(state)).toEqual([
      { from: 0, to: rangeOf(doc, "Cap").from, block: false },
      { from: rangeOf(doc, "Cap").to, to: rangeOf(doc, "Body").from, block: false },
      { from: rangeOf(doc, "Body").to, to: doc.indexOf("\nNext"), block: false },
    ]);
  });

  it("leaves a table figure on one line as source", () => {
    const doc = "#figure(table(columns: 2, [a], [b]), caption: [N])\nNext.";
    const state = typstState(doc, { cursor: doc.length });
    expect(widgetsOf(state, TypstTableWidget)).toEqual([]);
    expect(hiddenRanges(state)).toEqual([]);
  });

  it("falls back to source for tables the grid cannot model", () => {
    const doc = "#figure(\n  table(columns: 2, table.cell(colspan: 2)[x]),\n  caption: [Merged],\n)\nNext.";
    const state = typstState(doc, { cursor: doc.length });
    expect(widgetsOf(state, TypstTableWidget)).toEqual([]);
    expect(hiddenRanges(state)).toEqual([]);
  });
});

describe("Typst tables and images outside figures", () => {
  it("renders a top-level table as a grid", () => {
    const doc = "Before.\n#table(\n  columns: 2,\n  [a], [b],\n)\nAfter.";
    const state = typstState(doc, { cursor: 0 });
    const [grid] = widgetsOf(state, TypstTableWidget);
    expect([grid.from, grid.to, grid.block]).toEqual([doc.indexOf("#table"), doc.indexOf("\nAfter"), true]);
    expect(grid.widget.table.parsed.model.rows[0].cells.map((cell) => cell.content)).toEqual(["a", "b"]);
  });

  it("reveals the table source under the cursor", () => {
    const doc = "Before.\n#table(columns: 2, [a], [b])\nAfter.";
    expect(widgetsOf(typstState(doc, { cursor: doc.indexOf("[a]") + 1 }), TypstTableWidget)).toEqual([]);
  });

  it("renders a standalone image without a figure editor", () => {
    const doc = 'Before.\n#image("/assets/a.png", width: 50%)\nAfter.';
    const state = typstState(doc, {
      cursor: 0,
      ports: { resolveImage: async () => null, openFigureEditor: () => undefined },
    });
    const [image] = widgetsOf(state, GraphicsWidget);
    expect([image.from, image.to, image.block]).toEqual([doc.indexOf("#image"), doc.indexOf("\nAfter"), true]);
    expect(optionsOf(image.widget).path).toBe("assets/a.png");
    expect(optionsOf(image.widget).ports?.openFigureEditor).toBeUndefined();
  });
});
