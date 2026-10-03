import { beforeAll, describe, expect, it } from "vitest";
import { loadTypstParser } from "../../typst";
import { installEnglishEditorMessages } from "../../test-messages";
import { DescriptionItemWidget } from "../widgets/description-item";
import { FootnoteWidget } from "../widgets/footnote";
import { IconBraceWidget } from "../widgets/icon-brace";
import { IndicatorWidget } from "../widgets/indicator";
import { ItemWidget } from "../widgets/item";
import { PreambleWidget } from "../widgets/preamble";
import { typstVisualField } from "./field";
import { TypstMathWidget } from "./math";
import { hiddenRanges, lineClassesAt, rangeOf, replacedRanges, typstState, widgetsOf } from "./test-support";
import { RawLanguageWidget, TypstTextWidget } from "./widgets";

beforeAll(async () => {
  installEnglishEditorMessages();
  await loadTypstParser();
});

function span(doc: string, needle: string, occurrence = 0) {
  return rangeOf(doc, needle, occurrence);
}

describe("Typst headings", () => {
  const doc = "= Intro\n=== Deep dive <deep>\nBody text.\n";

  it("hides the heading markers while the cursor is elsewhere", () => {
    const state = typstState(doc, { cursor: doc.length });
    expect(hiddenRanges(state)).toContainEqual({ from: 0, to: 2, block: false });
    const deep = span(doc, "=== ");
    expect(hiddenRanges(state)).toContainEqual({ from: deep.from, to: deep.to, block: false });
  });

  it("reveals the marker of the heading line the cursor is on", () => {
    const state = typstState(doc, { cursor: span(doc, "Intro").to });
    const hidden = hiddenRanges(state);
    expect(hidden.some((range) => range.from === 0)).toBe(false);
    expect(hidden.some((range) => range.from === span(doc, "=== ").from)).toBe(true);
  });

  it("marks heading lines with their level", () => {
    const state = typstState(doc, { cursor: doc.length });
    expect(lineClassesAt(state, 0)).toContain("ofl-visual-typst-heading-1");
    expect(lineClassesAt(state, span(doc, "Deep").from)).toContain("ofl-visual-typst-heading-3");
  });
});

describe("Typst inline markup", () => {
  it("hides strong and emphasis delimiters until the cursor enters them", () => {
    const doc = "A *bold* and _it_ word.";
    const outside = typstState(doc, { cursor: doc.length });
    expect(hiddenRanges(outside)).toEqual([
      { from: 2, to: 3, block: false },
      { from: 7, to: 8, block: false },
      { from: 13, to: 14, block: false },
      { from: 16, to: 17, block: false },
    ]);
    const inside = typstState(doc, { cursor: 4 });
    expect(hiddenRanges(inside)).toEqual([
      { from: 13, to: 14, block: false },
      { from: 16, to: 17, block: false },
    ]);
  });

  it("hides inline raw delimiters and labels a fenced block with its language", () => {
    const doc = "Use `code` here.\n\n```python\nprint(1)\n```\n\nEnd.";
    const state = typstState(doc, { cursor: doc.length });
    const hidden = hiddenRanges(state);
    expect(hidden).toContainEqual({ from: 4, to: 5, block: false });
    expect(hidden).toContainEqual({ from: 9, to: 10, block: false });
    const [language] = widgetsOf(state, RawLanguageWidget);
    expect(language.widget.language).toBe("python");
    expect([language.from, language.to]).toEqual([span(doc, "```python").from, span(doc, "```python").to]);
    const close = span(doc, "```", 1);
    expect(hidden).toContainEqual({ from: close.from, to: close.to, block: false });
    expect(lineClassesAt(state, span(doc, "print").from)).toContain("ofl-visual-typst-raw-line");
  });

  it("hides the call around link text and keeps bare URLs as they are", () => {
    const doc = 'See #link("https://typst.app")[the site] and https://typst.app/docs.';
    const state = typstState(doc, { cursor: doc.length });
    const hidden = hiddenRanges(state);
    expect(hidden).toContainEqual({ from: span(doc, "#link").from, to: span(doc, "the site").from, block: false });
    const close = span(doc, "]");
    expect(hidden).toContainEqual({ from: close.from, to: close.to, block: false });
    expect(hidden.some((range) => range.from >= span(doc, "https://typst.app/docs").from)).toBe(false);
  });

  it("shows the URL of a link without content", () => {
    const doc = 'Visit #link("https://typst.app") now.';
    const state = typstState(doc, { cursor: doc.length });
    expect(hiddenRanges(state)).toEqual([
      { from: span(doc, "#link(").from, to: span(doc, "https").from, block: false },
      { from: span(doc, '")').from, to: span(doc, '")').to, block: false },
    ]);
  });

  it.each(["underline", "strike", "highlight", "smallcaps", "emph", "strong", "sub", "super"])(
    "hides the #%s call around its content",
    (name) => {
      const doc = `A #${name}[styled] word.`;
      const state = typstState(doc, { cursor: doc.length });
      expect(hiddenRanges(state)).toEqual([
        { from: 2, to: span(doc, "styled").from, block: false },
        { from: span(doc, "]").from, to: span(doc, "]").to, block: false },
      ]);
    },
  );

  it("renders smart quotes as curly quotes", () => {
    const doc = `He said "hi" and 'yo'.`;
    const state = typstState(doc, { cursor: 0 });
    expect(widgetsOf(state, TypstTextWidget).map((found) => found.widget.text)).toEqual([
      "“",
      "”",
      "‘",
      "’",
    ]);
  });

  it("renders escapes, shorthands and line breaks as their characters", () => {
    const doc = "Pay \\$5 \\u{1F600} -- --- wait... a~b line \\\nnext";
    const state = typstState(doc, { cursor: doc.length });
    const texts = widgetsOf(state, TypstTextWidget).map((found) => found.widget.text);
    expect(texts).toEqual(["$", "\u{1F600}", "–", "—", "…", " "]);
    const [linebreak] = widgetsOf(state, IndicatorWidget);
    expect(linebreak.widget.content).toBe("↩");
  });
});

describe("Typst lists", () => {
  it("replaces list, enum and term markers with item widgets", () => {
    const doc = "- first\n- second\n  - nested\n\n+ one\n+ two\n5. five\n\n/ Term: meaning\n";
    const state = typstState(doc, { cursor: doc.length });
    const items = widgetsOf(state, ItemWidget).map((found) => ({
      from: found.from,
      to: found.to,
      environment: found.widget.environment,
      ordinal: found.widget.ordinal,
      depth: found.widget.depth,
    }));
    const nested = doc.indexOf("  - nested");
    expect(items).toEqual([
      { from: 0, to: 2, environment: "itemize", ordinal: 1, depth: 1 },
      { from: 8, to: 10, environment: "itemize", ordinal: 2, depth: 1 },
      { from: nested, to: nested + 4, environment: "itemize", ordinal: 1, depth: 2 },
      { from: span(doc, "+ one").from, to: span(doc, "+ one").from + 2, environment: "enumerate", ordinal: 1, depth: 1 },
      { from: span(doc, "+ two").from, to: span(doc, "+ two").from + 2, environment: "enumerate", ordinal: 2, depth: 1 },
      { from: span(doc, "5. five").from, to: span(doc, "5. five").from + 3, environment: "enumerate", ordinal: 5, depth: 1 },
    ]);
    const [term] = widgetsOf(state, DescriptionItemWidget);
    expect([term.from, term.to]).toEqual([span(doc, "/ Term").from, span(doc, "/ Term").from + 2]);
  });

  it("keeps the markers hidden while the cursor is on the item", () => {
    const doc = "- first\n- second";
    const state = typstState(doc, { cursor: 4 });
    expect(widgetsOf(state, ItemWidget)).toHaveLength(2);
  });
});

describe("Typst references, labels and notes", () => {
  it("shows labels as markers until the cursor touches them", () => {
    const doc = "= Intro <intro>\nText.";
    const state = typstState(doc, { cursor: doc.length });
    const label = span(doc, "<intro>");
    const [marker] = widgetsOf(state, IconBraceWidget);
    expect([marker.from, marker.to, marker.widget.icon]).toEqual([label.from, label.from + 1, "tag"]);
    expect(hiddenRanges(state)).toContainEqual({ from: label.to - 1, to: label.to, block: false });
    const touched = typstState(doc, { cursor: label.to });
    expect(widgetsOf(touched, IconBraceWidget)).toEqual([]);
  });

  it("tells references to labels from citations", () => {
    const doc = "= Intro <intro>\nSee @intro and @smith2020.";
    const state = typstState(doc, { cursor: span(doc, "See").from + 1 });
    const icons = widgetsOf(state, IconBraceWidget).filter((found) => found.from > doc.indexOf("See"));
    expect(icons.map((found) => [found.from, found.widget.icon])).toEqual([
      [span(doc, "@intro").from, "tag"],
      [span(doc, "@smith2020").from, "book"],
    ]);
  });

  it("shows a reference supplement inside the chip without its brackets", () => {
    const doc = "= Intro <intro>\nSee @intro[Part] and @intro[] now.";
    const state = typstState(doc, { cursor: doc.length });
    const supplement = span(doc, "[Part]");
    const separators = widgetsOf(state, TypstTextWidget).filter(
      (found) => found.widget.className === "ofl-visual-typst-ref-supplement-separator",
    );
    expect(separators.map((found) => [found.from, found.to])).toEqual([[supplement.from, supplement.from + 1]]);
    const hidden = hiddenRanges(state);
    expect(hidden).toContainEqual({ from: supplement.to - 1, to: supplement.to, block: false });
    const empty = span(doc, "[]");
    expect(hidden).toContainEqual({ from: empty.from, to: empty.to, block: false });
    const touched = typstState(doc, { cursor: supplement.from + 2 });
    expect(
      widgetsOf(touched, TypstTextWidget).filter((found) => found.from === supplement.from),
    ).toEqual([]);
  });

  it("asks the host which keys are labels", () => {
    const doc = "See @fig-a and @book.";
    const state = typstState(doc, {
      cursor: 0,
      ports: {
        resolveImage: async () => null,
        referenceKind: (key) => (key === "fig-a" ? "label" : "citation"),
      },
    });
    expect(widgetsOf(state, IconBraceWidget).map((found) => found.widget.icon)).toEqual(["tag", "book"]);
  });

  it("shows #cite calls as citation chips", () => {
    const doc = "As #cite(<knuth>) shows.";
    const state = typstState(doc, { cursor: doc.length });
    const [icon] = widgetsOf(state, IconBraceWidget);
    expect([icon.from, icon.to, icon.widget.icon]).toEqual([3, span(doc, "knuth").from, "book"]);
    expect(hiddenRanges(state)).toContainEqual({ from: span(doc, ">)").from, to: span(doc, ">)").to, block: false });
  });

  it("collapses footnotes into a marker", () => {
    const doc = "Claim#footnote[A *source*.] holds.";
    const state = typstState(doc, { cursor: doc.length });
    const [note] = widgetsOf(state, FootnoteWidget);
    expect([note.from, note.to]).toEqual([5, span(doc, "] holds").from + 1]);
    expect(widgetsOf(typstState(doc, { cursor: 18 }), FootnoteWidget)).toEqual([]);
  });
});

describe("the Typst document settings bar", () => {
  const doc = '#set page(paper: "a4")\n#import "@preview/x:0.1.0": *\n\n// fonts\n#let accent = blue\n#show heading: set text(fill: accent)\n\n= Intro\nBody.\n';
  const settingsEnd = span(doc, "set text(fill: accent)").to;

  it("folds the leading set, show, import and let lines", () => {
    const state = typstState(doc, { cursor: doc.length });
    const [bar] = widgetsOf(state, PreambleWidget);
    expect(bar.widget.expanded).toBe(false);
    expect([bar.from, bar.to, bar.block]).toEqual([0, settingsEnd, true]);
    expect(state.field(typstVisualField).preamble.to).toBe(settingsEnd);
  });

  it("expands when the cursor is inside the settings", () => {
    const state = typstState(doc, { cursor: 3 });
    const [bar] = widgetsOf(state, PreambleWidget);
    expect(bar.widget.expanded).toBe(true);
    expect([bar.from, bar.to]).toEqual([0, 0]);
    expect(lineClassesAt(state, 0)).toContain("ofl-visual-preamble-line");
  });

  it("has no settings bar when the document starts with content", () => {
    const state = typstState("Hello\n#set text(size: 12pt)\n", { cursor: 0 });
    expect(widgetsOf(state, PreambleWidget)).toEqual([]);
    expect(state.field(typstVisualField).preamble.to).toBe(0);
  });
});

describe("Typst code and math", () => {
  it("never hides code expressions", () => {
    const doc = "Text first.\n#let x = 1\n#for i in range(2) [#i]\n#{ let y = 2 }\nValue #x and #pagebreak()";
    const state = typstState(doc, { cursor: 0 });
    expect(replacedRanges(state)).toEqual([]);
  });

  it("renders inline and display equations as widgets", () => {
    const doc = "Inline $x^2$ here.\n\n$ sum_i i $\n\nAfter.";
    const state = typstState(doc, { cursor: doc.length });
    const math = widgetsOf(state, TypstMathWidget).map((found) => ({
      from: found.from,
      to: found.to,
      source: found.widget.source,
      body: found.widget.body,
      display: found.widget.display,
      block: found.block,
    }));
    const display = span(doc, "$ sum_i i $");
    expect(math).toEqual([
      { from: 7, to: 12, source: "$x^2$", body: "x^2", display: false, block: false },
      { from: display.from, to: display.to, source: "$ sum_i i $", body: " sum_i i ", display: true, block: true },
    ]);
  });

  it("reveals the source of the equation under the cursor", () => {
    const doc = "Inline $x^2$ here.";
    expect(widgetsOf(typstState(doc, { cursor: 9 }), TypstMathWidget)).toEqual([]);
  });

  it("renders everything in a read-only document whatever the cursor", () => {
    const doc = "A *bold* $x$.";
    const state = typstState(doc, { cursor: 4, readOnly: true });
    expect(hiddenRanges(state)).toContainEqual({ from: 2, to: 3, block: false });
    expect(widgetsOf(state, TypstMathWidget)).toHaveLength(1);
  });
});
