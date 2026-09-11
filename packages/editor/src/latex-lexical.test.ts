import { EditorState, type ChangeSpec } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import {
  latexIgnoredRanges,
  latexIgnoredRangesField,
  type LatexIgnoredRange,
} from "./latex-lexical";

const stateWith = (doc: string): EditorState =>
  EditorState.create({ doc, extensions: [latexIgnoredRangesField] });

const trackedRanges = (state: EditorState): LatexIgnoredRange[] =>
  state.field(latexIgnoredRangesField);

const apply = (state: EditorState, changes: ChangeSpec): EditorState =>
  state.update({ changes }).state;

function expectMatchesFullScan(state: EditorState): void {
  expect(trackedRanges(state)).toEqual(
    latexIgnoredRanges(state.doc.toString()),
  );
}

const SAMPLE = [
  "\\documentclass{article}",
  "% preamble note",
  "\\begin{document}",
  "First paragraph. % first note",
  "Second uses \\verb|raw code| inline. % second note",
  "\\begin{verbatim}",
  "raw % not a comment",
  "\\end{verbatim}",
  "Third paragraph. % third note",
  "Fourth paragraph. % fourth note",
  "\\end{document}",
].join("\n");

describe("latexIgnoredRangesField incremental rescans", () => {
  it("rewrites only the edited comment and shifts the ranges below it", () => {
    const state = stateWith(SAMPLE);
    const before = trackedRanges(state);
    const at = SAMPLE.indexOf("% first note") + "% first".length;

    const next = apply(state, { from: at, insert: " drafted" });
    const after = trackedRanges(next);

    expect(after).toHaveLength(before.length);
    expect(after[0]).toBe(before[0]);
    expect(after[1].from).toBe(before[1].from);
    expect(after[1].to).toBe(before[1].to + " drafted".length);
    for (let index = 2; index < before.length; index += 1) {
      expect(after[index]).toEqual({
        ...before[index],
        from: before[index].from + " drafted".length,
        to: before[index].to + " drafted".length,
      });
    }
    expectMatchesFullScan(next);
  });

  it("extends the ignored range to the closing end when an opener is typed near the top", () => {
    const doc = [
      "Intro line. % intro note",
      "",
      "Body with % body note",
      "\\end{verbatim}",
      "Tail line. % tail note",
    ].join("\n");
    const state = stateWith(doc);
    expect(trackedRanges(state).map((range) => range.kind)).toEqual([
      "comment",
      "comment",
      "comment",
    ]);

    const openerAt = doc.indexOf("\n") + 1;
    const next = apply(state, {
      from: openerAt,
      insert: "\\begin{verbatim}",
    });
    const after = trackedRanges(next);

    expect(after).toHaveLength(3);
    expect(after[0]).toEqual(trackedRanges(state)[0]);
    expect(after[1]).toEqual({
      from: openerAt,
      to:
        next.doc.toString().indexOf("\\end{verbatim}") +
        "\\end{verbatim}".length,
      kind: "verbatim-environment",
      complete: true,
    });
    expect(after[2].kind).toBe("comment");
    expectMatchesFullScan(next);
  });

  it("restores the ranges below when the environment is closed again", () => {
    const doc = [
      "Intro line. % intro note",
      "\\begin{verbatim}",
      "Body with % body note",
      "Tail line. % tail note",
    ].join("\n");
    const state = stateWith(doc);
    const opened = trackedRanges(state);
    expect(opened).toHaveLength(2);
    expect(opened[1].complete).toBe(false);
    expect(opened[1].to).toBe(doc.length);

    const closerAt = doc.indexOf("Body with");
    const next = apply(state, {
      from: closerAt,
      insert: "\\end{verbatim}\n",
    });
    const after = trackedRanges(next);

    expect(after.map((range) => range.kind)).toEqual([
      "comment",
      "verbatim-environment",
      "comment",
      "comment",
    ]);
    expect(after[1].complete).toBe(true);
    expectMatchesFullScan(next);
  });

  it("keeps every earlier range untouched for an edit at the end of the document", () => {
    const state = stateWith(SAMPLE);
    const before = trackedRanges(state);

    const next = apply(state, {
      from: SAMPLE.length,
      insert: "\n% trailing note",
    });
    const after = trackedRanges(next);

    expect(after).toHaveLength(before.length + 1);
    for (let index = 0; index < before.length; index += 1) {
      expect(after[index]).toBe(before[index]);
    }
    expect(after[after.length - 1].kind).toBe("comment");
    expectMatchesFullScan(next);
  });

  it("maps the ranges below a converged point through insertions and deletions above them", () => {
    const state = stateWith(SAMPLE);
    const before = trackedRanges(state);
    const headLineEnd = SAMPLE.indexOf("\n");

    const inserted = apply(state, {
      from: headLineEnd,
      insert: "\n\\usepackage{amsmath}\n\\usepackage{graphicx}",
    });
    const grown = "\n\\usepackage{amsmath}\n\\usepackage{graphicx}".length;
    const afterInsert = trackedRanges(inserted);
    expect(afterInsert).toHaveLength(before.length);
    for (let index = 0; index < before.length; index += 1) {
      expect(afterInsert[index]).toEqual({
        ...before[index],
        from: before[index].from + grown,
        to: before[index].to + grown,
      });
    }
    expectMatchesFullScan(inserted);

    const shrunk = apply(inserted, { from: headLineEnd, to: headLineEnd + grown });
    expect(trackedRanges(shrunk)).toEqual(before);
    expectMatchesFullScan(shrunk);
  });

  it("does not resume early when a group opened above the rescan window stays unclosed inside it", () => {
    const filler = Array.from(
      { length: 260 },
      (_, index) => `prose line ${index} carries no group delimiters`,
    ).join("\n");
    const doc = ["start of file", filler, "closing text } here", "% tail note"]
      .join("\n");
    expect(doc.indexOf("}")).toBeGreaterThan(6 * 1024);

    const state = stateWith(doc);
    expect(trackedRanges(state)).toHaveLength(1);

    const next = apply(state, {
      from: "start of file\n".length,
      insert: "\\mintinline{py}{",
    });
    const after = trackedRanges(next);

    expect(after[0].kind).toBe("inline-verbatim");
    expect(after[0].to).toBe(
      next.doc.toString().indexOf("closing text } here") +
        "closing text }".length,
    );
    expectMatchesFullScan(next);
  });

  it("agrees with a full rescan across a long sequence of scattered edits", () => {
    const blocks: string[] = [];
    for (let index = 0; index < 220; index += 1) {
      blocks.push(`Paragraph ${index} of prose. % note ${index}`);
      if (index % 5 === 0) {
        blocks.push("\\begin{lstlisting}");
        blocks.push(`sample % ${index} not a comment`);
        blocks.push("\\end{lstlisting}");
      }
      if (index % 7 === 0) {
        blocks.push(`Inline \\verb!raw ${index}! and \\% escaped.`);
      }
    }
    const source = blocks.join("\n");
    expect(source.length).toBeGreaterThan(8 * 1024);
    let state = stateWith(source);

    let seed = 20260911;
    const random = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const inserts = [
      "x",
      "%",
      "\\",
      "\n",
      "}",
      "{",
      "\\begin{verbatim}",
      "\\end{verbatim}",
      " word ",
    ];

    for (let step = 0; step < 240; step += 1) {
      const at = Math.floor(random() * state.doc.length);
      if (random() < 0.35 && at < state.doc.length) {
        const width = 1 + Math.floor(random() * 12);
        state = apply(state, {
          from: at,
          to: Math.min(state.doc.length, at + width),
        });
      } else {
        state = apply(state, {
          from: at,
          insert: inserts[Math.floor(random() * inserts.length)],
        });
      }
      expectMatchesFullScan(state);
    }
  });
});
