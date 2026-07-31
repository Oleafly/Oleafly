// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CompletionContext,
  type Completion,
  type CompletionResult,
} from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  loadAtSuggestions,
  setCorpusTransport,
} from "@oleafly/latex-intelligence";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  atSuggestionCompletion,
  isMathContext,
  setAtSuggestionsForTest,
  warmAtSuggestions,
} from "./at-suggestions";

// Under jsdom, fileURLToPath must receive import.meta.url as a string; a URL
// constructed with `new URL(..., import.meta.url)` is a jsdom URL instance
// that node:fs and fileURLToPath reject.
const DATA_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../public/latex-intelligence",
);

// The production loader fetches the corpus over HTTP from public/. Tests run
// under Node, so back the transport with the filesystem copy instead, then
// warm the module's sync cache through the same load path production uses.
beforeAll(async () => {
  setCorpusTransport(async (relativePath) => {
    try {
      return JSON.parse(readFileSync(join(DATA_DIR, relativePath), "utf8")) as unknown;
    } catch {
      return null;
    }
  });
  warmAtSuggestions();
  const loaded = await loadAtSuggestions();
  expect(loaded).not.toBeNull();
  // Let warmAtSuggestions' .then() populate the sync cache.
  await new Promise((resolve) => setTimeout(resolve, 0));
});

afterAll(() => {
  setCorpusTransport(null);
});

function complete(doc: string, pos = doc.length): CompletionResult | null {
  const state = EditorState.create({ doc });
  const value = atSuggestionCompletion(
    new CompletionContext(state, pos, false),
  );
  if (value && typeof (value as Promise<unknown>).then === "function") {
    throw new Error("Expected synchronous completion");
  }
  return value as CompletionResult | null;
}

function option(
  result: CompletionResult | null,
  label: string,
): Completion | undefined {
  return result?.options.find((candidate) => candidate.label === label);
}

describe("isMathContext", () => {
  it("is true strictly inside $...$ and false on and outside the delimiters", () => {
    const doc = "prose $a+b$ prose";
    expect(isMathContext(doc, doc.indexOf("a"))).toBe(true);
    expect(isMathContext(doc, doc.indexOf("+"))).toBe(true);
    // Just after the opening $ and just before the closing $ count as inside.
    expect(isMathContext(doc, doc.indexOf("$") + 1)).toBe(true);
    expect(isMathContext(doc, doc.lastIndexOf("$"))).toBe(true);
    // On/outside the delimiters does not.
    expect(isMathContext(doc, doc.indexOf("$"))).toBe(false);
    expect(isMathContext(doc, doc.lastIndexOf("$") + 1)).toBe(false);
    expect(isMathContext(doc, 0)).toBe(false);
    expect(isMathContext(doc, doc.length)).toBe(false);
  });

  it("is true inside \\[...\\] display math", () => {
    const doc = "before \\[ E = mc^2 \\] after";
    expect(isMathContext(doc, doc.indexOf("E"))).toBe(true);
    expect(isMathContext(doc, 0)).toBe(false);
    expect(isMathContext(doc, doc.length)).toBe(false);
  });

  it("is true inside a $$...$$ display equation", () => {
    const doc = "before\n$$\n\\Delta = b^2 - 4ac\n$$\nafter";
    expect(isMathContext(doc, doc.indexOf("\\Delta") + 2)).toBe(true);
    expect(isMathContext(doc, doc.indexOf("before"))).toBe(false);
    expect(isMathContext(doc, doc.length)).toBe(false);
  });

  it("is false everywhere in prose", () => {
    const doc = "just some prose with an email@example.com address";
    for (let pos = 0; pos <= doc.length; pos += 1) {
      expect(isMathContext(doc, pos)).toBe(false);
    }
  });

  it("still sees math delimited within 2 KB of the cursor", () => {
    const doc = `${"p".repeat(5000)} $x + y$`;
    expect(isMathContext(doc, doc.length - 1)).toBe(true);
  });

  it("does not see an opening delimiter beyond the 2 KB window", () => {
    // An unclosed $ keeps the cursor in math while the $ is inside the
    // window, but once the cursor drifts more than 2 KB past the opening
    // delimiter the window no longer contains it.
    const doc = `$${"x".repeat(5000)}`;
    expect(isMathContext(doc, 1000)).toBe(true);
    expect(isMathContext(doc, doc.length)).toBe(false);
  });
});

describe("atSuggestionCompletion", () => {
  it("offers the vendored triggers inside math", () => {
    const result = complete("$@");
    expect(result).not.toBeNull();
    expect(result?.from).toBe(1);
    const alpha = option(result, "@a");
    expect(alpha).toBeTruthy();
    expect(alpha?.detail).toBe("alpha");
    expect(alpha?.type).toBe("keyword");
    // The corpus core.json details advertise "Δ, shortcut @D" — make it real.
    expect(option(result, "@D")).toBeTruthy();
  });

  it("anchors the replacement range at the @ of a longer token", () => {
    const doc = "\\[ x @le";
    const result = complete(doc);
    expect(result).not.toBeNull();
    expect(result?.from).toBe(doc.indexOf("@"));
  });

  it("returns null in prose", () => {
    expect(complete("prose @a")).toBeNull();
  });

  it("returns null without an @ token", () => {
    expect(complete("$x + y$", 4)).toBeNull();
  });

  it("returns null while the data is unloaded, then recovers once loaded", async () => {
    setAtSuggestionsForTest(null);
    try {
      // Unloaded: null, but the query kicks warmAtSuggestions.
      expect(complete("$@")).toBeNull();
      await loadAtSuggestions();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(complete("$@")).not.toBeNull();
    } finally {
      // The load above restored the cache from the fs-backed transport.
      expect(complete("$@")).not.toBeNull();
    }
  });

  it("applies the snippet replacement over the whole @token", () => {
    const doc = "$@a$";
    const view = new EditorView({
      state: EditorState.create({ doc, selection: { anchor: 3 } }),
      parent: document.body,
    });
    try {
      const result = atSuggestionCompletion(
        new CompletionContext(view.state, 3, false),
      ) as CompletionResult | null;
      expect(result).not.toBeNull();
      const alpha = option(result, "@a");
      expect(alpha).toBeTruthy();
      expect(typeof alpha?.apply).toBe("function");
      (alpha?.apply as (
        view: EditorView,
        completion: Completion,
        from: number,
        to: number,
      ) => void)(view, alpha as Completion, result?.from ?? 0, 3);
      expect(view.state.doc.toString()).toBe("$\\alpha$");
      expect(view.state.selection.main.head).toBe("$\\alpha".length);
    } finally {
      view.destroy();
    }
  });

  it("closes instead of applying when the document moved on", () => {
    const doc = "$@a$";
    const view = new EditorView({
      state: EditorState.create({ doc }),
      parent: document.body,
    });
    try {
      const result = atSuggestionCompletion(
        new CompletionContext(view.state, 3, false),
      ) as CompletionResult | null;
      const alpha = option(result, "@a");
      expect(alpha).toBeTruthy();
      // The document changes before the completion is applied.
      view.dispatch({ changes: { from: 0, to: 0, insert: "z" } });
      (alpha?.apply as (
        view: EditorView,
        completion: Completion,
        from: number,
        to: number,
      ) => void)(view, alpha as Completion, 1, 3);
      expect(view.state.doc.toString()).toBe("z$@a$");
    } finally {
      view.destroy();
    }
  });
});
