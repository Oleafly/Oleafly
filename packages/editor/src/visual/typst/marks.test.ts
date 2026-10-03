import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import type { Decoration } from "@codemirror/view";
import { beforeAll, describe, expect, it } from "vitest";
import { loadTypstParser } from "../../typst";
import type { VisualPorts } from "../types";
import { buildTypstMarks } from "./marks";
import { typstState } from "./test-support";

beforeAll(async () => {
  await loadTypstParser();
});

interface Mark {
  text: string;
  className: string;
  style?: string;
}

function marksOf(doc: string, ports?: VisualPorts): Mark[] {
  const state: EditorState = typstState(doc, { cursor: 0, ports });
  const set = buildTypstMarks(state, syntaxTree(state), [{ from: 0, to: doc.length }]);
  const found: Mark[] = [];
  const cursor = set.iter();
  while (cursor.value) {
    const spec = (cursor.value as Decoration).spec;
    found.push({
      text: doc.slice(cursor.from, cursor.to),
      className: spec.class,
      ...(spec.attributes?.style ? { style: spec.attributes.style } : {}),
    });
    cursor.next();
  }
  return found;
}

function classesFor(doc: string, text: string, ports?: VisualPorts): string[] {
  return marksOf(doc, ports)
    .filter((mark) => mark.text === text)
    .map((mark) => mark.className);
}

describe("Typst mark decorations", () => {
  it("styles headings, strong and emphasis", () => {
    const doc = "== Section title\nSome *bold* and _soft_ words.";
    expect(classesFor(doc, "Section title")).toContain("ofl-visual-heading");
    expect(classesFor(doc, "*bold*")).toContain("ofl-visual-typst-strong");
    expect(classesFor(doc, "_soft_")).toContain("ofl-visual-typst-emph");
  });

  it("styles raw text, links and comments", () => {
    const doc = "Run `ls` at https://typst.app // a note\n/* block */";
    expect(classesFor(doc, "`ls`")).toContain("ofl-visual-typst-raw");
    expect(classesFor(doc, "https://typst.app")).toContain("ofl-visual-link-text");
    expect(classesFor(doc, "// a note")).toContain("ofl-visual-typst-comment");
    expect(classesFor(doc, "/* block */")).toContain("ofl-visual-typst-comment");
  });

  it("subdues code but leaves the markup inside content blocks alone", () => {
    const doc = "Text\n#for x in (1, 2) [Item *#x*]\n#let y = 2";
    const marks = marksOf(doc).filter((mark) => mark.className === "ofl-visual-typst-code");
    expect(marks.map((mark) => mark.text)).toEqual(["#for x in (1, 2) [", "#x", "]", "#let y = 2"]);
    expect(classesFor(doc, "*#x*")).toContain("ofl-visual-typst-strong");
  });

  it("styles the content of formatting calls", () => {
    const doc = "#underline[u] #strike[s] #highlight[h] #smallcaps[c] #text(fill: red)[r] #text(size: 9pt)[plain]";
    expect(classesFor(doc, "u")).toContain("ofl-visual-typst-underline");
    expect(classesFor(doc, "s")).toContain("ofl-visual-typst-strike");
    expect(classesFor(doc, "h")).toContain("ofl-visual-typst-highlight");
    expect(classesFor(doc, "c")).toContain("ofl-visual-typst-smallcaps");
    expect(marksOf(doc).find((mark) => mark.text === "r" && mark.className === "ofl-visual-typst-text")?.style).toBe(
      "color: red",
    );
    expect(classesFor(doc, "plain")).not.toContain("ofl-visual-typst-text");
  });

  it("styles references as label or citation chips", () => {
    const doc = "= Intro <intro>\nSee @intro and @knuth and #cite(<lamport>).";
    expect(classesFor(doc, "@intro")).toContain("ofl-visual-chip ofl-visual-chip-ref");
    expect(classesFor(doc, "@knuth")).toContain("ofl-visual-chip ofl-visual-chip-cite");
    expect(classesFor(doc, "#cite(<lamport>)")).toContain("ofl-visual-chip ofl-visual-chip-cite");
    expect(classesFor(doc, "<intro>")).toContain("ofl-visual-chip ofl-visual-chip-label ofl-visual-typst-label");
    const ports: VisualPorts = { resolveImage: async () => null, referenceKind: () => "label" };
    expect(classesFor(doc, "@knuth", ports)).toContain("ofl-visual-chip ofl-visual-chip-ref");
  });

  it("keeps a reference supplement inside the chip and styles it as text", () => {
    const doc = "= Intro <intro>\nSee @intro[Part one] now.";
    expect(classesFor(doc, "@intro[Part one]")).toContain("ofl-visual-chip ofl-visual-chip-ref");
    expect(classesFor(doc, "Part one")).toContain("ofl-visual-typst-ref-supplement");
  });

  it("styles figure captions and term names", () => {
    const doc = '#figure(image("a.png"), caption: [A caption])\n/ Term: meaning';
    expect(classesFor(doc, "A caption")).toContain("ofl-visual-typst-caption");
    expect(classesFor(doc, "Term")).toContain("ofl-visual-typst-term");
  });
});
