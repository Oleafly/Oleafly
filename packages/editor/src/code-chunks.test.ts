import { ensureSyntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { classHighlighter, highlightTree } from "@lezer/highlight";
import { beforeAll, describe, expect, it } from "vitest";
import { CODE_CHUNK_LANGUAGES, codeChunkLanguage } from "./code-chunks";
import { languageForPath } from "./languages";
import { loadTypstParser, typstLanguage } from "./typst";
import { typstContextAt } from "./typst-editing";

beforeAll(async () => {
  await Promise.all([loadTypstParser(), ...CODE_CHUNK_LANGUAGES.map((language) => language.load())]);
});

function classesOf(path: string, doc: string, token: string, from = 0): string[] {
  const language = languageForPath(path);
  if (!language) throw new Error(`No language for ${path}`);
  const state = EditorState.create({ doc, extensions: [language] });
  const tree = ensureSyntaxTree(state, doc.length, 1_000);
  if (!tree) throw new Error(`The tree for ${path} did not finish parsing`);
  const start = doc.indexOf(token, from);
  if (start < 0) throw new Error(`${token} is not in the document`);
  const classes: string[] = [];
  highlightTree(tree, classHighlighter, (spanFrom, spanTo, spanClasses) => {
    if (spanFrom < start + token.length && spanTo > start) classes.push(spanClasses);
  });
  return classes;
}

describe("codeChunkLanguage", () => {
  it.each([
    ["{r}", "R"],
    ["{r", "R"],
    ["{r,echo=FALSE}", "R"],
    ["{python}", "Python"],
    ["{.python}", "Python"],
    ["python", "Python"],
    ["py", "Python"],
    ["{julia}", "Julia"],
    ["{ojs}", "OJS"],
    ["{bash}", "Bash"],
    ["sh", "Bash"],
    ["R", "R"],
  ])("reads %s as %s", (info, name) => {
    expect(codeChunkLanguage(info)?.name).toBe(name);
  });

  it.each(["", "{}", "{mermaid}", "dot", "{=latex}", "rust"])("knows no chunk language for %s", (info) => {
    expect(codeChunkLanguage(info)).toBeNull();
  });
});

describe("code chunk highlighting", () => {
  it("highlights a braced Quarto chunk with the language it names", () => {
    const doc = "Text\n\n```{python}\n#| label: fig-plot\nimport numpy\n```\n";
    expect(classesOf("paper.qmd", doc, "import")).toContain("tok-keyword");
    expect(classesOf("paper.qmd", doc, "#|")).toContain("tok-meta");
    expect(classesOf("paper.qmd", doc, "label")).toContain("tok-propertyName");
    expect(classesOf("paper.qmd", doc, "fig-plot")).toContain("tok-meta");
  });

  it("highlights knitr-style R chunk headers and Observable chunks", () => {
    const doc = "```{r setup, echo=FALSE}\nlibrary(ggplot2)\nx <- function() TRUE\n```\n\n```{ojs}\n#| echo: false\nconst y = 1\n```\n";
    expect(classesOf("analysis.Rmd", doc, "function")).toContain("tok-keyword");
    expect(classesOf("analysis.Rmd", doc, "#|")).toContain("tok-meta");
    expect(classesOf("analysis.Rmd", doc, "const")).toContain("tok-keyword");
  });

  it("highlights plain fenced code in Markdown the same way", () => {
    const doc = "# Notes\n\n```python\nimport os\n```\n";
    expect(classesOf("notes.md", doc, "import")).toContain("tok-keyword");
  });

  it("leaves display-only and unknown fences as plain code", () => {
    const doc = "```{mermaid}\ngraph TD\n```\n";
    expect(classesOf("paper.qmd", doc, "graph").some((classes) => classes.includes("tok-keyword"))).toBe(false);
  });

  it("highlights Calepin raw blocks in Typst with their language", () => {
    const doc = '#import "/.calepin/calepin.typ"\n\n```python\n#| echo: false\nimport numpy\n```\n\n```r\nx <- function() 1\n```\n';
    expect(classesOf("main.typ", doc, "import", doc.indexOf("```python"))).toContain("tok-keyword");
    expect(classesOf("main.typ", doc, "#|")).toContain("tok-meta");
    expect(classesOf("main.typ", doc, "echo")).toContain("tok-propertyName");
    expect(classesOf("main.typ", doc, "function")).toContain("tok-keyword");
  });

  it("keeps a raw block without a known language as Typst raw text", () => {
    const doc = "```rust\nfn main() {}\n```\n";
    const classes = classesOf("main.typ", doc, "fn main");
    expect(classes.some((value) => value.includes("tok-string"))).toBe(true);
    expect(classes.some((value) => value.includes("tok-keyword"))).toBe(false);
  });

  it("keeps the Typst editing context inside a highlighted raw block", () => {
    const doc = "Text\n\n```python\n# note\nimport numpy\n```\n";
    const state = EditorState.create({ doc, extensions: [typstLanguage()] });
    ensureSyntaxTree(state, doc.length, 1_000);
    expect(typstContextAt(state, doc.indexOf("note"))).toBe("raw");
    expect(typstContextAt(state, doc.indexOf("numpy"))).toBe("raw");
    expect(typstContextAt(state, 2)).toBe("markup");
  });
});
