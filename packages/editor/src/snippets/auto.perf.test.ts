import { EditorSelection, EditorState, type Transaction, type TransactionSpec } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { buildLibrary, parseSnippetFile } from "@oleafly/snippets";
import { describe, expect, it } from "vitest";
import { latexLanguage } from "../latex";
import { installEnglishEditorMessages } from "../test-messages";
import { snippetAutoExpand } from "./auto";
import { snippetGhostHint } from "./hint";
import { snippetPortFacet } from "./port";
import { snippetSessionExtension } from "./session";
import { fakePort } from "./tests/editor";

const DOCUMENT_BYTES = 5 * 1024 * 1024;
const KEYSTROKES = 5_000;
const WARMUP = 500;
const LETTERS = "abcdefghijklmnopqrstuvwxyz";
const TYPED = `${LETTERS}${LETTERS}eeettaaoinsr0123456789//{}^_ `;

function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function largeLatex(next: () => number): string {
  const parts: string[] = [];
  let size = 0;
  let paragraph = 0;
  while (size < DOCUMENT_BYTES) {
    const lines = paragraph % 40 === 0 ? 60 : 8;
    for (let line = 0; line < lines; line += 1) {
      const math = line % 3 === 0 ? ` with $x_{${line}} + \\alpha^2 = \\frac{a}{b}$ in it` : "";
      const text = `Sensor node ${paragraph} samples the field ${Math.floor(next() * 1000)} times${math}, then sleeps.\n`;
      parts.push(text);
      size += text.length;
    }
    parts.push(paragraph % 7 === 0 ? "\\begin{equation}\n  E = mc^2\n\\end{equation}\n\n" : "\n");
    paragraph += 1;
  }
  return parts.join("");
}

function trigger(index: number): string {
  const first = LETTERS[index % 26];
  const second = LETTERS[Math.floor(index / 26) % 26];
  return index % 5 === 0 ? `${first}${second}${LETTERS[(index * 7) % 26]}` : `${first}${second}`;
}

function snippetFile(): string {
  const entries: Record<string, unknown> = {};
  for (let index = 0; index < 700; index += 1) {
    entries[`auto.${index}`] = {
      prefix: index % 50 === 0 ? `${trigger(index)}/` : trigger(index),
      body: index % 3 === 0 ? "\\frac{$1}{$2}$0" : `\\cmd${index}`,
      expand: "auto",
      where: index % 2 === 0 ? "math" : "text",
      inWord: index % 4 === 0,
    };
  }
  for (let index = 0; index < 100; index += 1) {
    const end = ["(\\d)", "([A-Za-z])", "q", "/"][index % 4];
    entries[`regex.${index}`] = {
      prefix: `re:(?<![\\\\A-Za-z])([A-Za-z])${LETTERS[index % 26]}${end}`,
      body: "[[0]]_{[[1]]}",
      expand: "auto",
      where: "math",
      inWord: true,
    };
  }
  for (let index = 0; index < 200; index += 1) {
    entries[`tab.${index}`] = { prefix: `t${trigger(index)}`, body: "\\begin{x}$1\\end{x}$0", expand: "tab", where: "text" };
  }
  return JSON.stringify(entries);
}

class TimedView {
  composing = false;
  compositionStarted = false;

  constructor(public state: EditorState) {}

  dispatch(...specs: (Transaction | TransactionSpec)[]): void {
    const [first] = specs;
    this.state = specs.length === 1 && "startState" in first ? first.state : this.state.update(...(specs as TransactionSpec[])).state;
  }
}

function quantile(sorted: readonly number[], q: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
}

describe("auto expansion on a large document", () => {
  it("keeps each keystroke cheap with a thousand snippets", () => {
    installEnglishEditorMessages();
    const next = random(536);
    const file = parseSnippetFile(snippetFile(), "perf", "pack");
    expect(file.records).toHaveLength(1_000);
    const library = buildLibrary({ files: [file], disabledCollections: new Set(), overrides: [], disabledRegex: new Set() });
    const port = fakePort({ library: () => library });
    const doc = largeLatex(next);
    expect(doc.length).toBeGreaterThanOrEqual(DOCUMENT_BYTES);
    const view = new TimedView(
      EditorState.create({
        doc,
        extensions: [latexLanguage(), snippetSessionExtension(), snippetAutoExpand(), snippetPortFacet.of(port)],
      }),
    );
    const [handler] = view.state.facet(EditorView.inputHandler);
    const hint = snippetGhostHint();
    const samples: number[] = [];
    const hintSamples: number[] = [];
    let expanded = 0;
    for (let round = 0; round < WARMUP + KEYSTROKES; round += 1) {
      const pos = Math.floor(next() * view.state.doc.length);
      const text = TYPED[Math.floor(next() * TYPED.length)];
      view.state = view.state.update({ selection: EditorSelection.cursor(pos) }).state;
      const insert = () => view.state.update({ changes: { from: pos, insert: text }, selection: EditorSelection.cursor(pos + 1), userEvent: "input.type" });
      const started = performance.now();
      const fired = handler(view as unknown as EditorView, pos, pos, text, insert);
      const spent = performance.now() - started;
      const hinted = performance.now();
      hint(view.state);
      const hintSpent = performance.now() - hinted;
      if (round >= WARMUP) {
        samples.push(spent);
        hintSamples.push(hintSpent);
      }
      if (fired) expanded += 1;
    }
    samples.sort((a, b) => a - b);
    hintSamples.sort((a, b) => a - b);
    expect(expanded).toBeGreaterThan(0);
    expect(quantile(samples, 0.5)).toBeLessThan(0.2);
    expect(quantile(samples, 0.95)).toBeLessThan(2);
    expect(quantile(hintSamples, 0.5)).toBeLessThan(0.2);
    expect(quantile(hintSamples, 0.95)).toBeLessThan(2);
  }, 120_000);
});
