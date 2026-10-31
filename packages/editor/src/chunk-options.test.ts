// @vitest-environment jsdom

import {
  CompletionContext,
  type CompletionResult,
  type CompletionSource,
} from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  CALEPIN_CHUNK_OPTIONS,
  calepinChunkOptionCompletions,
  QUARTO_CHUNK_OPTIONS,
  quartoChunkOptionCompletions,
} from "./chunk-options";
import { installEnglishEditorMessages } from "./test-messages";
import { stubRangeGeometry } from "./test-geometry";

stubRangeGeometry();

const views: EditorView[] = [];

beforeAll(() => installEnglishEditorMessages());

afterEach(() => {
  while (views.length > 0) views.pop()?.destroy();
  document.body.replaceChildren();
});

function complete(
  source: CompletionSource,
  doc: string,
  pos = doc.length,
  state = EditorState.create({ doc }),
): CompletionResult | null {
  const result = source(new CompletionContext(state, pos, false));
  if (result instanceof Promise) throw new Error("expected a synchronous result");
  return result;
}

function labels(result: CompletionResult | null): string[] {
  return result?.options.map((option) => option.label) ?? [];
}

function accepted(source: CompletionSource, doc: string, label: string): string {
  const parent = document.createElement("div");
  document.body.append(parent);
  const view = new EditorView({
    parent,
    state: EditorState.create({ doc, selection: { anchor: doc.length } }),
  });
  views.push(view);
  const result = complete(source, doc, doc.length, view.state);
  const option = result?.options.find((candidate) => candidate.label === label);
  if (!result || typeof option?.apply !== "function") throw new Error(`no ${label} completion`);
  option.apply(view, option, result.from, doc.length);
  return view.state.doc.toString();
}

describe("quartoChunkOptionCompletions", () => {
  it("offers every Quarto option after #| at the top of a braced chunk", () => {
    const doc = "Text\n\n```{r}\n#| ";
    const result = complete(quartoChunkOptionCompletions, doc);
    expect(result?.from).toBe(doc.length);
    expect(labels(result)).toEqual(QUARTO_CHUNK_OPTIONS);
    for (const option of result?.options ?? []) {
      expect(option.type).toBe("property");
      expect(option.detail).toBe("Quarto chunk option");
    }
  });

  it("completes a partial name into a key and a separator", () => {
    expect(accepted(quartoChunkOptionCompletions, "```{python}\n#| fig-c", "fig-cap")).toBe(
      "```{python}\n#| fig-cap: ",
    );
    expect(complete(quartoChunkOptionCompletions, "```{python}\n#| fig-c")?.from).toBe(
      "```{python}\n#| ".length,
    );
  });

  it("follows earlier option lines and leaves out options already set", () => {
    const doc = "```{r setup, include=FALSE}\n#| label: setup\n#| echo: false\n#| ";
    const result = labels(complete(quartoChunkOptionCompletions, doc));
    expect(result).not.toContain("label");
    expect(result).not.toContain("echo");
    expect(result).toContain("eval");
    const below = "```{r}\n#| \n#| warning: false\n";
    expect(labels(complete(quartoChunkOptionCompletions, below, "```{r}\n#| ".length))).not.toContain("warning");
  });

  it("stays out of prose, plain fences and lines below the chunk code", () => {
    expect(complete(quartoChunkOptionCompletions, "#| ")).toBeNull();
    expect(complete(quartoChunkOptionCompletions, "Text\n#| ")).toBeNull();
    expect(complete(quartoChunkOptionCompletions, "```python\n#| ")).toBeNull();
    expect(complete(quartoChunkOptionCompletions, "```{.python}\n#| ")).toBeNull();
    expect(complete(quartoChunkOptionCompletions, "```{r}\nx <- 1\n#| ")).toBeNull();
    expect(complete(quartoChunkOptionCompletions, "```{r}\n#| echo: false")).toBeNull();
  });
});

describe("calepinChunkOptionCompletions", () => {
  it("offers every Calepin option after #| at the top of a raw block", () => {
    const doc = '#import "/.calepin/calepin.typ"\n\n```python\n#| ';
    const result = complete(calepinChunkOptionCompletions, doc);
    expect(labels(result)).toEqual(CALEPIN_CHUNK_OPTIONS);
    expect(result?.options[0]?.detail).toBe("Calepin chunk option");
  });

  it("works inside a chunk call and after indentation", () => {
    expect(labels(complete(calepinChunkOptionCompletions, "#calepin.chunk(echo: false)[```r\n  #| res"))).toContain(
      "results-location",
    );
    expect(accepted(calepinChunkOptionCompletions, "```julia\n#| fig-al", "fig-alt-text")).toBe(
      "```julia\n#| fig-alt-text: ",
    );
  });

  it("stays out of Typst markup and raw blocks without a language", () => {
    expect(complete(calepinChunkOptionCompletions, "Text\n#| ")).toBeNull();
    expect(complete(calepinChunkOptionCompletions, "```\n#| ")).toBeNull();
    expect(complete(calepinChunkOptionCompletions, "```python\nprint(1)\n#| ")).toBeNull();
  });
});
