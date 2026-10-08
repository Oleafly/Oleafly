import { syntaxTree } from "@codemirror/language";
import { EditorSelection, EditorState, type TransactionSpec } from "@codemirror/state";
import type { DecorationSet } from "@codemirror/view";
import { Tree } from "@lezer/common";
import { afterEach, describe, expect, it, vi } from "vitest";
import { latexTreeSupport } from "../latex-tree";
import { buildAtomicDecorations, visualAtomicField } from "./atomic-decorations";
import { visualMode } from "./index";
import { LIST_DOCUMENT, parsedState, SAMPLE_DOCUMENT } from "./test-document";

const ports = { resolveImage: async () => null };

const BODY = String.raw`\section{Plain prose}
This paragraph is plain prose that the reader edits all the time.
It keeps going on a second line with more words in it.

\begin{itemize}
  \item First point with \textbf{bold} words
  plain continuation line inside the list
  \item Second point
\end{itemize}
\begin{lemma}[Named]
  A lemma body line with ordinary words.
\end{lemma}
\begin{examplewrap}
Custom environment body text without any commands.
\end{examplewrap}
\begin{figure}[h]
  \centering
  a figure line of text
  \caption{A caption}
\end{figure}
Inline $x + y$ math and a \cite{key} on this line.
\begin{tabular}{ll}
  cell text & more \\
  plain row text in a table
\end{tabular}
% a comment line
Final plain line of the chapter body.
`;

const DOCUMENT = SAMPLE_DOCUMENT.replace(String.raw`\end{document}`, `${BODY}\\end{document}`);

function createState(doc: string, cursor = 0): EditorState {
  return parsedState(
    EditorState.create({
      doc,
      selection: { anchor: cursor },
      extensions: [latexTreeSupport(), visualMode(ports)],
    }),
  );
}

function describeSet(set: DecorationSet, length: number): string[] {
  const found: string[] = [];
  set.between(0, length, (from, to, value) => {
    const widget = value.spec.widget as { constructor: { name: string }; eq?: (other: unknown) => boolean } | undefined;
    found.push(
      `${from}:${to}:${value.spec.class ?? ""}:${widget?.constructor.name ?? ""}:${value.spec.block ? "block" : ""}`,
    );
  });
  return found;
}

function expectMatchesFullBuild(state: EditorState) {
  const field = state.field(visualAtomicField);
  const tree = syntaxTree(state);
  if (field.tree !== tree || tree.length < state.doc.length) return;
  const fresh = buildAtomicDecorations(state, tree);
  expect(describeSet(field.decorations, state.doc.length)).toEqual(
    describeSet(fresh.decorations, state.doc.length),
  );
  expect(field.probes.map(({ from, to, hit }) => [from, to, hit])).toEqual(
    fresh.probes.map(({ from, to, hit }) => [from, to, hit]),
  );
  expect(field.preamble.to).toBe(fresh.preamble.to);
  expect([...field.theorems.keys()]).toEqual([...fresh.theorems.keys()]);
}

function typeAt(state: EditorState, position: number, text: string): EditorState {
  const spec: TransactionSpec = {
    changes: { from: position, insert: text },
    selection: EditorSelection.cursor(position + text.length),
    userEvent: "input.type",
  };
  return state.update(spec).state;
}

function deleteBefore(state: EditorState, position: number): EditorState {
  return state.update({
    changes: { from: position - 1, to: position },
    selection: EditorSelection.cursor(position - 1),
    userEvent: "delete.backward",
  }).state;
}

function editablePositions(doc: string): number[] {
  const positions: number[] = [];
  let offset = 0;
  for (const line of doc.split("\n")) {
    if (line.length > 4) positions.push(offset + Math.floor(line.length / 2));
    offset += line.length + 1;
  }
  return positions;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("visual atomic decorations while typing", () => {
  it("matches a full rebuild after typing anywhere in the document", () => {
    const iterate = vi.spyOn(Tree.prototype, "iterate");
    let incremental = 0;
    const step = (state: EditorState, edit: (state: EditorState) => EditorState) => {
      const walks = iterate.mock.calls.length;
      const next = edit(state);
      const walked = iterate.mock.calls
        .slice(walks)
        .some(([spec]) => spec.from === undefined && spec.to === undefined);
      if (!walked && next.field(visualAtomicField).tree === syntaxTree(next)) incremental += 1;
      expectMatchesFullBuild(next);
      return next;
    };
    for (const position of editablePositions(DOCUMENT)) {
      let state = createState(DOCUMENT, position);
      for (const text of ["x", " "]) {
        state = step(state, (current) => typeAt(current, current.selection.main.head, text));
      }
      step(state, (current) => deleteBefore(current, current.selection.main.head));
    }
    expect(incremental).toBeGreaterThan(20);
  });

  it("matches a full rebuild after typing into a list document", () => {
    for (const position of editablePositions(LIST_DOCUMENT)) {
      const state = typeAt(createState(LIST_DOCUMENT, position), position, "z");
      expectMatchesFullBuild(state);
    }
  });

  it("does not walk the whole syntax tree when a keystroke only extends plain prose", () => {
    const position = DOCUMENT.indexOf("plain prose that") + 5;
    const state = createState(DOCUMENT, position);
    const iterate = vi.spyOn(Tree.prototype, "iterate");

    const next = typeAt(state, position, "x");

    const wholeTreeWalks = iterate.mock.calls.filter(([spec]) => spec.from === undefined && spec.to === undefined);
    expect(wholeTreeWalks).toHaveLength(0);
    expectMatchesFullBuild(next);
  });

  it("still rebuilds when a keystroke changes the structure", () => {
    const position = DOCUMENT.indexOf("plain prose that") + 5;
    const state = createState(DOCUMENT, position);
    const iterate = vi.spyOn(Tree.prototype, "iterate");

    const next = parsedState(typeAt(state, position, "$a$"));

    const wholeTreeWalks = iterate.mock.calls.filter(([spec]) => spec.from === undefined && spec.to === undefined);
    expect(wholeTreeWalks.length).toBeGreaterThan(0);
    expectMatchesFullBuild(next);
  });
});
