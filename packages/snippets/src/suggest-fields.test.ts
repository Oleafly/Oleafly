import { describe, expect, it } from "vitest";
import { parseBody } from "./body";
import { type RenderEnv, renderBody } from "./render";
import { bodyFromSelection, type FieldSuggestion, suggestFields } from "./suggest-fields";
import type { SnippetLanguage } from "./types";

const ENV: RenderEnv = {
  selection: "",
  clipboard: "",
  now: new Date(2026, 10, 25),
  fileName: null,
  projectName: null,
  lineComment: "%",
  captures: [],
  indent: "",
  indentUnit: "\t",
};

function dollars(strings: TemplateStringsArray): string {
  return String.raw({ raw: strings.raw }).replaceAll("§", "$");
}

const BOOKTABS = String.raw`\begin{table}[t]\centering
\caption{Field evaluation results.}\label{tab:results}
\begin{tabular}{@{}lrrr@{}}\toprule
Method & Recall & FA/wk & Latency \\\midrule
Periodic stream & .957 & 1.8 & 72 s \\
\bottomrule
\end{tabular}
\end{table}`;

function shape(text: string, language: SnippetLanguage) {
  return suggestFields(text, language).map(({ kind, text: value, selected, linkedTo }) => ({
    kind,
    text: value,
    selected,
    ...(linkedTo === undefined ? {} : { linkedTo: text.slice(linkedTo, linkedTo + 5) }),
  }));
}

function body(text: string, accepted: readonly FieldSuggestion[]): string {
  const result = bodyFromSelection(text, accepted);
  expect(parseBody(result).errors).toEqual([]);
  return result;
}

function renders(text: string, accepted: readonly FieldSuggestion[]): string {
  return renderBody(parseBody(body(text, accepted)).nodes, ENV).text;
}

describe("suggestFields in LaTeX", () => {
  it("finds the four fields of the booktabs table and links the label", () => {
    expect(shape(BOOKTABS, "latex")).toEqual([
      { kind: "caption", text: "Field evaluation results.", selected: true },
      { kind: "label", text: "results", selected: true, linkedTo: "Field" },
      { kind: "column-spec", text: "@{}lrrr@{}", selected: true },
      {
        kind: "table-body",
        text: String.raw`Method & Recall & FA/wk & Latency \\\midrule
Periodic stream & .957 & 1.8 & 72 s \\`,
        selected: false,
      },
    ]);
  });

  it("builds the body with the selected fields and a slug for the linked label", () => {
    const suggestions = suggestFields(BOOKTABS, "latex");
    const selected = suggestions.filter((suggestion) => suggestion.selected);
    expect(body(BOOKTABS, selected)).toBe(dollars`\begin{table}[t]\centering
\caption{§{1:Field evaluation results.}}\label{tab:§{1/slug}}
\begin{tabular}{§{2:@{\}lrrr@{\}}}\toprule
Method & Recall & FA/wk & Latency \\\\\\midrule
Periodic stream & .957 & 1.8 & 72 s \\\\
\bottomrule
\end{tabular}
\end{table}§0`);
    expect(renders(BOOKTABS, selected)).toBe(BOOKTABS.replace("tab:results", "tab:field-evaluation-results"));
  });

  it("drops the slug mirror when the label is unticked", () => {
    const suggestions = suggestFields(BOOKTABS, "latex");
    const withoutLabel = suggestions.filter((suggestion) => suggestion.selected && suggestion.kind !== "label");
    const result = body(BOOKTABS, withoutLabel);
    expect(result).not.toContain("/slug}");
    expect(result).toContain(String.raw`\label{tab:results}`);
    expect(renders(BOOKTABS, withoutLabel)).toBe(BOOKTABS);
  });

  it("makes the label its own field when the caption is unticked", () => {
    const suggestions = suggestFields(BOOKTABS, "latex");
    const labelOnly = suggestions.filter((suggestion) => suggestion.kind === "label");
    expect(body(BOOKTABS, labelOnly)).toContain(dollars`\label{tab:§{1:results}}`);
    expect(renders(BOOKTABS, suggestions)).toContain("tab:field-evaluation-results");
  });

  it("finds citations, paths, titles and standalone numbers", () => {
    const text = String.raw`\section{Results}\label{sec:results}
See \citep[p.~3]{smith2020,doe2021} and \parencite{roe}.
\includegraphics[width=0.8\linewidth]{figures/map.png}
\input{chapters/intro}
\vspace{2em} 12 apples, 3.5 and x2.`;
    expect(shape(text, "latex")).toEqual([
      { kind: "title", text: "Results", selected: true },
      { kind: "label", text: "results", selected: true, linkedTo: "Resul" },
      { kind: "number", text: "3", selected: false },
      { kind: "cite", text: "smith2020,doe2021", selected: true },
      { kind: "cite", text: "roe", selected: true },
      { kind: "number", text: "0.8", selected: false },
      { kind: "path", text: "figures/map.png", selected: true },
      { kind: "path", text: "chapters/intro", selected: true },
      { kind: "number", text: "12", selected: false },
      { kind: "number", text: "3.5", selected: false },
    ]);
    const all = suggestFields(text, "latex");
    expect(body(text, all)).toContain(dollars`\citep[p.~§{2:3}]{§{3@cite:smith2020,doe2021}}`);
    expect(body(text, all)).toContain("{${6@image:figures/map.png}}");
    expect(body(text, all)).toContain("{${7@file:chapters/intro}}");
    expect(renders(text, all)).toBe(text);
  });

  it("keeps a label without a prefix whole and leaves odd labels alone", () => {
    const text = String.raw`\caption{Map}\label{map}\label{fig:}\label{has space}\label{fig:other}`;
    expect(shape(text, "latex")).toEqual([
      { kind: "caption", text: "Map", selected: true },
      { kind: "label", text: "map", selected: true, linkedTo: "Map}\\" },
      { kind: "label", text: "fig:", selected: true },
      { kind: "label", text: "other", selected: true },
    ]);
  });

  it("links a label that starts with the caption's slug", () => {
    const text = String.raw`\caption{Loss curve}\label{fig:loss-curve-2}`;
    expect(suggestFields(text, "latex")[1].linkedTo).toBe(9);
    expect(suggestFields(String.raw`\caption{!!}\label{fig:x}`, "latex")[1].linkedTo).toBeUndefined();
  });

  it("skips unclosed groups and tables without an end", () => {
    expect(suggestFields(String.raw`\caption{open`, "latex")).toEqual([]);
    expect(shape(String.raw`\begin{tabular}{ll} a & b`, "latex")).toEqual([{ kind: "column-spec", text: "ll", selected: true }]);
    expect(shape(String.raw`\begin{tabular}{ll}\toprule\bottomrule\end{tabular}`, "latex")).toEqual([
      { kind: "column-spec", text: "ll", selected: true },
    ]);
    expect(shape(String.raw`\begin{tabular}{} x`, "latex")).toEqual([]);
  });

  it("trims table rules only at a word boundary", () => {
    const text = "\\begin{tabular}{l}\\topruled x \\\\\n\\bottomrule\n\\end{tabular}";
    expect(shape(text, "latex").filter((field) => field.kind === "table-body")).toEqual([
      { kind: "table-body", text: "\\topruled x \\\\", selected: false },
    ]);
  });

  it("keeps escaped braces inside a group", () => {
    expect(shape(String.raw`\caption{a \} b \{ c}`, "latex")).toEqual([{ kind: "caption", text: String.raw`a \} b \{ c`, selected: true }]);
  });
});

describe("suggestFields in Typst", () => {
  const text = `= Results
#figure(
  image("figures/map.png", width: 80%),
  caption: [Ignition map of the [48] nodes],
) <fig:ignition-map>
See @fig:ignition-map, @smith2020. and a@b.com`;

  it("finds the caption, label, image, citation and heading", () => {
    expect(shape(text, "typst")).toEqual([
      { kind: "title", text: "Results", selected: true },
      { kind: "path", text: "figures/map.png", selected: true },
      { kind: "caption", text: "Ignition map of the [48] nodes", selected: true },
      { kind: "label", text: "ignition-map", selected: true, linkedTo: "Ignit" },
      { kind: "cite", text: "smith2020", selected: true },
    ]);
    const all = suggestFields(text, "typst");
    expect(body(text, all)).toContain('image("${2@image:figures/map.png}"');
    expect(body(text, all)).toContain("<fig:${3/slug}>");
  });
});

describe("suggestFields reads headings line by line", () => {
  it("takes a Typst heading after tabs and skips a bare marker", () => {
    expect(shape("==\t Results\t\n=\n= \t", "typst")).toEqual([{ kind: "title", text: "Results", selected: true }]);
  });

  it("takes Markdown headings of one to six marks and drops closing marks", () => {
    expect(shape("####### Seven\n## Results\t##\t\n#Tight\n# ##", "markdown")).toEqual([
      { kind: "title", text: "Results", selected: true },
      { kind: "title", text: "##", selected: true },
    ]);
  });
});

describe("suggestFields in Markdown and Notes", () => {
  const text = `# Field notes #
![Ignition map](figures/map.png "Map"){#fig:map}
As shown [@smith2020; @doe]. ![](empty.png)`;

  it("finds the image, its label, the citation and the heading", () => {
    const expected = [
      { kind: "title", text: "Field notes", selected: true },
      { kind: "caption", text: "Ignition map", selected: true },
      { kind: "path", text: "figures/map.png", selected: true },
      { kind: "label", text: "map", selected: true, linkedTo: "Ignit" },
      { kind: "cite", text: "smith2020", selected: true },
      { kind: "path", text: "empty.png", selected: true },
    ];
    expect(shape(text, "markdown")).toEqual(expected);
    expect(shape(text, "notes")).toEqual(expected);
    expect(body(text, suggestFields(text, "markdown"))).toContain("](${3@image:figures/map.png}");
  });

  it("needs a path for an image and keeps the caption on one line", () => {
    expect(shape("![no path]() and ![a](b) ![c\n](d)", "markdown")).toEqual([
      { kind: "caption", text: "a", selected: true },
      { kind: "path", text: "b", selected: true },
    ]);
  });

  it("offers nothing for BibTeX", () => {
    expect(suggestFields("@article{key, title = {A}}", "bibtex")).toEqual([]);
  });
});

describe("bodyFromSelection", () => {
  it("escapes text and ends with $0", () => {
    expect(body("costs $5 \\", [])).toBe("costs \\$5 \\\\$0");
  });

  it("ignores overlapping suggestions", () => {
    const text = "abcdef";
    const accepted: FieldSuggestion[] = [
      { kind: "number", from: 1, to: 4, text: "bcd", selected: true },
      { kind: "number", from: 2, to: 5, text: "cde", selected: true },
      { kind: "label", from: 5, to: 6, text: "f", selected: true, linkedTo: 99 },
    ];
    expect(body(text, accepted)).toBe("a${1:bcd}e${2:f}$0");
  });
});
