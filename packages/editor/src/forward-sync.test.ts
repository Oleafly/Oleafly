import { describe, expect, it } from "vitest";
import { findWordOnPages, linesFromAnchor, pickForwardLine, type PdfTextRun, type SyncTexLine } from "./forward-sync";

const LEADING = 12;

/** One run per typeset line, as pdf.js reports TeX output, starting at `top`. */
function page(lines: readonly string[], top = 100): PdfTextRun[] {
  return lines.map((str, index) => ({
    str,
    x: 72,
    top: top + index * LEADING,
    width: str.length * 5,
    height: 10,
    hasEOL: true,
  }));
}

function line(pageNo: number, index: number, top = 100, stretch?: [number, number]): SyncTexLine {
  return {
    page: pageNo,
    x: 72,
    y: top + index * LEADING - 1,
    width: 400,
    height: 12,
    from: stretch?.[0] ?? 72,
    to: stretch?.[1] ?? 472,
  };
}

describe("finding the cursor's word among a source line's typeset lines", () => {
  const paragraph = [
    "The model of the data shows the effect, and the",
    "model of the noise is the value of the study, while",
    "the model of the field reduces the error of the",
    "model in the sample.",
  ];
  const runs = new Map([[1, page(paragraph)]]);
  const lines = paragraph.map((_, index) => line(1, index));

  it("picks the line whose words around the cursor's word match the source", () => {
    const source = "The model of the data shows the effect, and the model of the noise is the value of the study, while the model of the field reduces the error of the model in the sample.";
    const at = (occurrence: number) => {
      let index = -1;
      for (let k = 0; k <= occurrence; k++) index = source.indexOf("model", index + 1);
      return { word: "model", before: source.slice(0, index), after: source.slice(index + 5) };
    };
    expect(pickForwardLine(lines, runs, at(0))).toEqual(lines[0]);
    expect(pickForwardLine(lines, runs, at(1))).toEqual(lines[1]);
    expect(pickForwardLine(lines, runs, at(2))).toEqual(lines[2]);
    expect(pickForwardLine(lines, runs, at(3))).toEqual(lines[3]);
  });

  it("ignores markup in the source and generated text in the PDF", () => {
    const source = String.raw`as the \emph{effect} of the change~\cite{knuth} shows`;
    const at = source.indexOf("effect");
    const typeset = new Map([[1, page(["the first lines of the effect, and more", "as the effect of the change [1] shows"])]]);
    const spot = { word: "effect", before: source.slice(0, at), after: source.slice(at + 6) };
    expect(pickForwardLine([line(1, 0), line(1, 1)], typeset, spot)).toEqual(line(1, 1));
  });

  it("prefers the stretch SyncTeX gives for the source line when a phrase repeats", () => {
    // A wrapped source line ends the first typeset line and starts the second;
    // the start of the first belongs to the source line above.
    const typeset = new Map([[1, page(["noise of the data and the start of our line", "noise of the data ends it and the next one"])]]);
    const lines = [line(1, 0, 100, [200, 287]), line(1, 1, 100, [72, 160])];
    const spot = { word: "noise", before: "", after: " of the data" };
    expect(pickForwardLine(lines, typeset, spot)).toEqual(lines[1]);
  });

  it("joins a word LaTeX hyphenated at a line end", () => {
    const typeset = new Map([[1, page(["the first sentence with mea-", "surements of the data"])]]);
    const spot = { word: "measurements", before: "sentence with ", after: " of the data" };
    expect(pickForwardLine([line(1, 0), line(1, 1)], typeset, spot)).toEqual(line(1, 0));
  });

  it("reads the words around an occurrence across a page break", () => {
    const pages = new Map([
      [1, page(["the model of the noise and the value", "of the study and the model"])],
      [2, page(["of the field reduces the error"])],
    ]);
    // Only the words after it tell the two apart, and they are on the next page.
    const spot = { word: "model", before: "", after: " of the field reduces the error" };
    expect(pickForwardLine([line(1, 0), line(1, 1), line(2, 0)], pages, spot)).toEqual(line(1, 1));
  });

  it("spells out ligatures the way the source has them", () => {
    const typeset = new Map([[1, page(["is diﬀerent from the eﬀect"])]]);
    const spot = { word: "different", before: "is ", after: " from the effect" };
    expect(pickForwardLine([line(1, 0)], typeset, spot)).toEqual(line(1, 0));
  });

  it("gives up when the word is on none of the lines", () => {
    expect(pickForwardLine(lines, runs, { word: "knuth", before: "~\\cite{", after: "}" })).toBeNull();
    expect(pickForwardLine([], runs, { word: "model", before: "", after: "" })).toBeNull();
  });
});

describe("finding the cursor's word on a page SyncTeX has no line for", () => {
  const title = page(["A Robust Network for Signal Prediction in Noisy Fields", "Ada Lovelace and Grace Hopper", "1 Introduction", "The network of the signal predicts the field."], 80);
  const runs = new Map([[1, title]]);

  it("finds `\\title` text when the words around it agree", () => {
    const spot = { word: "Network", before: "\\title{A Robust ", after: " for Signal Prediction in Noisy Fields}\n\\author{Ada Lovelace and Grace Hopper}" };
    expect(findWordOnPages([1], runs, spot)).toEqual({ page: 1, x: 72, y: 80, width: title[0].width, height: 10 });
  });

  it("refuses a match the words around it do not back up", () => {
    const spot = { word: "the", before: "\\date{", after: "} as of" };
    expect(findWordOnPages([1], runs, spot)).toBeNull();
  });
});

describe("candidate lines around a Typst forward jump", () => {
  /** Where the app draws a Typst jump: 96 by 12 points from 9 above the baseline. */
  function jump(pageNo: number, run: PdfTextRun) {
    return { page: pageNo, x: run.x, y: run.top + run.height - 9, width: 96, height: 12 };
  }

  it("counts the lines from the jump on as the block's own and the ones before only as candidates", () => {
    const text = page(["Earlier paragraph ends here.", "The model of the data is simple.", "It holds for every model we tried.", "A later paragraph."]);
    const lines = linesFromAnchor(jump(1, text[1]), new Map([[1, text]]));
    expect(lines.map((candidate) => [candidate.y, candidate.from, candidate.to])).toEqual([
      [100, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY],
      [112, 72, 72 + text[1].width],
      [124, 72, 72 + text[2].width],
      [136, 72, 72 + text[3].width],
    ]);
  });

  it("finds the cursor's word lines below the paragraph start the server jumps to", () => {
    const text = page(["Earlier paragraph ends here.", "The model of the data is simple.", "It holds for every model we tried.", "A later paragraph."]);
    const runs = new Map([[1, text]]);
    const spot = { word: "model", before: "The model of the data is simple. It holds for every ", after: " we tried." };
    expect(pickForwardLine(linesFromAnchor(jump(1, text[1]), runs), runs, spot)?.y).toBe(124);
  });

  it("looks back onto the previous page when the server names a paragraph's part after a page break", () => {
    const first = page(["Some text above.", "A paragraph that starts with a method", "and carries on"]);
    const second = page(["over the page break.", "Next paragraph."], 72);
    const runs = new Map([
      [1, first],
      [2, second],
    ]);
    const lines = linesFromAnchor(jump(2, second[0]), runs);
    expect(lines.map((candidate) => candidate.page)).toEqual([1, 1, 1, 2, 2]);
    const spot = { word: "method", before: "A paragraph that starts with a ", after: " and carries on over the page break." };
    expect(pickForwardLine(lines, runs, spot)).toMatchObject({ page: 1, y: 112 });
  });

  it("keeps a typeset line whole when bold or a link splits it into several runs", () => {
    const runs: PdfTextRun[] = [
      { str: "The ", x: 72, top: 100, width: 20, height: 10 },
      { str: "bold", x: 92, top: 100.5, width: 22, height: 10 },
      { str: " text.", x: 114, top: 100, width: 30, height: 10, hasEOL: true },
      { str: " ", x: 144, top: 100, width: 0, height: 10, hasEOL: true },
      { str: "Next line.", x: 72, top: 112, width: 50, height: 10, hasEOL: true },
    ];
    const lines = linesFromAnchor(jump(1, runs[0]), new Map([[1, runs]]));
    expect(lines).toEqual([
      { page: 1, x: 72, y: 100, width: 72, height: 10.5, from: 72, to: 144 },
      { page: 1, x: 72, y: 112, width: 50, height: 10, from: 72, to: 122 },
    ]);
  });

  it("has nothing when no text is at or below the jump", () => {
    const text = page(["Only line."]);
    expect(linesFromAnchor({ page: 1, x: 72, y: 400, width: 96, height: 12 }, new Map([[1, text]]))).toEqual([]);
  });
});
