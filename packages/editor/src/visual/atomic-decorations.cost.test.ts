import { syntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { NodeType } from "@lezer/common";
import { afterEach, describe, expect, it, vi } from "vitest";
import { latexTreeSupport } from "../latex-tree";
import { buildAtomicDecorations } from "./atomic-decorations";
import { visualMode } from "./index";
import { parsedState, SAMPLE_DOCUMENT } from "./test-document";

const ports = { resolveImage: async () => null };

function createState(doc: string): EditorState {
  return parsedState(
    EditorState.create({ doc, extensions: [latexTreeSupport(), visualMode(ports)] }),
  );
}

function nodeCount(state: EditorState): number {
  let count = 0;
  syntaxTree(state).iterate({
    enter: () => {
      count += 1;
    },
  });
  return count;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("visual atomic decoration rebuild cost", () => {
  it("classifies each node type once instead of testing every node against every kind", () => {
    const doc = Array.from({ length: 40 }, () => SAMPLE_DOCUMENT).join("\n");
    const state = createState(doc);
    buildAtomicDecorations(state, syntaxTree(state));
    const nodes = nodeCount(state);
    const is = vi.spyOn(NodeType.prototype, "is");

    buildAtomicDecorations(state, syntaxTree(state));

    expect(is.mock.calls.length).toBeLessThan(nodes * 2);
  });

  it("builds the same decorations as a fresh build", () => {
    const state = createState(SAMPLE_DOCUMENT);
    const first = buildAtomicDecorations(state, syntaxTree(state));
    const second = buildAtomicDecorations(state, syntaxTree(state));
    const ranges = (set: typeof first.decorations) => {
      const found: string[] = [];
      set.between(0, state.doc.length, (from, to, value) => {
        found.push(`${from}:${to}:${value.spec.class ?? value.spec.widget?.constructor.name ?? "mark"}`);
      });
      return found;
    };
    expect(ranges(second.decorations)).toEqual(ranges(first.decorations));
    expect(second.preamble).toEqual(first.preamble);
  });
});
