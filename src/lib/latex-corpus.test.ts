// @vitest-environment jsdom

import {
  CompletionContext,
  type Completion,
  type CompletionResult,
} from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { latexCommandCompletions } from "@oleafly/editor";
import { loadCore, setCorpusTransport } from "@oleafly/latex-intelligence";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { installLatexCorpus } from "./latex-corpus";

const corpusDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../public/latex-intelligence",
);

beforeAll(async () => {
  setCorpusTransport(async (relativePath) => {
    try {
      return JSON.parse(
        await readFile(join(corpusDir, relativePath), "utf8"),
      ) as unknown;
    } catch {
      return null;
    }
  });
  installLatexCorpus();
  await loadCore();
  // Let the corpus module's .then() callbacks fill its synchronous caches.
  await new Promise((done) => setTimeout(done, 0));
});

function completion(doc: string): CompletionResult | null {
  const state = EditorState.create({ doc });
  return latexCommandCompletions(new CompletionContext(state, doc.length, false));
}

function option(result: CompletionResult | null, label: string): Completion {
  const found = result?.options.find(
    (candidate) => String(candidate.label) === label,
  );
  if (!found) throw new Error(`Missing completion ${label}`);
  return found;
}

function accepted(doc: string, label: string): string {
  const view = new EditorView({
    state: EditorState.create({ doc }),
    parent: document.body,
  });
  const context = new CompletionContext(view.state, doc.length, false);
  const result = latexCommandCompletions(context);
  if (!result) throw new Error(`No completion result for ${doc}`);
  const chosen = option(result, label);
  if (typeof chosen.apply !== "function") {
    throw new Error(`${label} has no apply`);
  }
  chosen.apply(view, chosen, result.from, doc.length);
  const text = view.state.doc.toString();
  view.destroy();
  return text;
}

describe("corpus delimiter snippets", () => {
  it("loads the corpus into the editor completion source", () => {
    const labels = (completion("\\left")?.options ?? []).map((entry) =>
      String(entry.label),
    );
    expect(labels).toContain(String.raw`\left(`);
  });

  it("keeps the backslash on a corpus brace delimiter", () => {
    expect(accepted("\\left", String.raw`\left{`)).toBe(
      String.raw`\left\{\right\}`,
    );
    expect(accepted("\\bigl", String.raw`\bigl{`)).toBe(
      String.raw`\bigl\{\bigr\}`,
    );
  });

  it("leaves a corpus snippet with plain group braces untouched", () => {
    expect(accepted("\\frac", String.raw`\frac{}{}`)).toBe(
      String.raw`\frac{}{}`,
    );
  });

  it("still expands the corpus paren and bracket delimiters", () => {
    expect(accepted("\\left", String.raw`\left(`)).toBe(
      String.raw`\left(\right)`,
    );
    expect(accepted("\\Biggl", String.raw`\Biggl[`)).toBe(
      String.raw`\Biggl[\Biggr]`,
    );
  });
});
