import type { DiagramModel } from "@oleafly/latex";
import { describe, expect, it } from "vitest";
import {
  DIAGRAM_LANGUAGES,
  diagramLanguage,
  isDiagramLanguageId,
  languageForPath,
  modelMarkLine,
  readModelMark,
  typstPageLine,
  typstPreviewDocument,
  withoutModelMark,
} from "./index";
import { mermaidLanguage } from "./mermaid";
import { tikzLanguage } from "./tikz";
import { typstLanguage } from "./typst";

const MODEL: DiagramModel = {
  version: 1,
  nodes: [
    { id: "a", shape: "rectangle", x: 0, y: 0, w: 80, h: 40, label: "Start" },
    { id: "b", shape: "rectangle", x: 0, y: 120, w: 80, h: 40, label: "End" },
  ],
  edges: [{ id: "e1", source: "a", target: "b", routing: "straight", arrow: "forward", style: "solid" }],
};

describe("diagram language registry", () => {
  it("looks every language up by its id", () => {
    expect(Object.keys(DIAGRAM_LANGUAGES)).toEqual(["tikz", "typst", "mermaid"]);
    expect(diagramLanguage("tikz")).toBe(tikzLanguage);
    expect(diagramLanguage("typst")).toBe(typstLanguage);
    expect(diagramLanguage("mermaid")).toBe(mermaidLanguage);
  });

  it.each([
    ["tikz", true],
    ["typst", true],
    ["mermaid", true],
    ["svg", false],
    ["TikZ", false],
    [null, false],
    [3, false],
  ])("treats %j as a language id: %s", (value, expected) => {
    expect(isDiagramLanguageId(value)).toBe(expected);
  });

  it.each([
    ["figures/flow.TIKZ", "tikz"],
    ["main.tex", "tikz"],
    ["notes.latex", "tikz"],
    ["old.ltx", "tikz"],
    ["paper.typ", "typst"],
    ["README.md", "mermaid"],
    ["guide.markdown", "mermaid"],
    ["chart.mmd", "mermaid"],
    ["figure.png", null],
    ["tex", null],
    ["", null],
    [null, null],
    [undefined, null],
  ])("picks the language for %j", (path, expected) => {
    expect(languageForPath(path)).toBe(expected);
  });
});

describe("TikZ language", () => {
  it("reads a picture and lists the commands it had to drop", () => {
    const read = tikzLanguage.read(String.raw`\begin{tikzpicture}
\node[draw] (a) at (0,0) {A};
\foreach \x in {1,2} { \node at (\x,0) {x}; }
\end{tikzpicture}`);
    expect(read.model?.nodes.map((node) => node.label)).toEqual(["A"]);
    expect(read.extras).toBeNull();
    expect(read.notes).toEqual([{ kind: "dropped", code: "tikzCommand", detail: "foreach" }]);
  });

  it("notes when a picture is too long to read whole", () => {
    const read = tikzLanguage.read(`\\begin{tikzpicture}\n${";".repeat(20_001)}\n\\end{tikzpicture}`);
    expect(read.notes).toContainEqual({ kind: "dropped", code: "truncated" });
  });

  it("round-trips a standalone document back to its figure body and background", () => {
    const standalone = tikzLanguage.standaloneSource({ ...MODEL, background: "#ABCDEF" });
    expect(standalone).toContain(String.raw`\documentclass[tikz,border=4pt]{standalone}`);
    expect(standalone).toContain(String.raw`\pagecolor{obgcolor}`);
    const body = tikzLanguage.fromStandalone(standalone);
    expect(body.background).toBe("#abcdef");
    expect(body.code.startsWith(String.raw`\begin{tikzpicture}`)).toBe(true);
    expect(body.code).not.toContain("obgcolor");
    expect(body.code).not.toContain(String.raw`\begin{document}`);
  });

  it("leaves the background unset when the document has none", () => {
    const body = tikzLanguage.fromStandalone(tikzLanguage.standaloneSource(MODEL));
    expect(body).toEqual({ code: expect.stringContaining(String.raw`\node (a)`) });
  });

  it.each([
    String.raw`\begin{tikzpicture}\node {A};\end{tikzpicture}`,
    String.raw`\end{document} stray \begin{document}`,
  ])("treats %j as a bare figure", (source) => {
    expect(tikzLanguage.fromStandalone(source)).toEqual({ code: source });
  });

  it("writes figure code, file contents and insertion text", async () => {
    await expect(tikzLanguage.load()).resolves.toBeUndefined();
    expect(tikzLanguage.ready()).toBe(true);
    expect(tikzLanguage.write(MODEL)).toContain(String.raw`\begin{tikzpicture}`);
    expect(tikzLanguage.fileSource(MODEL)).toContain("oleafly-diagram-v1:");
    expect(tikzLanguage.fromFile("fig.tikz", "raw content")).toBe("raw content");
    expect(tikzLanguage.insertText("  \\node {A};  \n\n")).toBe("\\node {A};\n");
  });

  it("asks the fixer for the figure body with the code and log tail", () => {
    const prompt = tikzLanguage.fixPrompt("\\node {A}", "! Missing ;");
    expect(prompt.system).toContain("Tectonic");
    expect(prompt.user).toContain("CODE:\n\\node {A}");
    expect(prompt.user).toContain("COMPILE LOG (tail):\n! Missing ;");
  });
});

describe("Mermaid language", () => {
  it("writes flowchart code, file contents and fenced standalone source", async () => {
    await expect(mermaidLanguage.load()).resolves.toBeUndefined();
    expect(mermaidLanguage.ready()).toBe(true);
    const code = mermaidLanguage.write(MODEL);
    expect(code).toMatch(/^flowchart/);
    expect(code).toContain("Start");
    const file = mermaidLanguage.fileSource(MODEL);
    expect(file.endsWith("\n")).toBe(true);
    expect(readModelMark(file, "%%")).toEqual(MODEL);
    const standalone = mermaidLanguage.standaloneSource(MODEL);
    expect(standalone.startsWith("```mermaid\n")).toBe(true);
    expect(standalone.endsWith("```\n")).toBe(true);
  });

  it("pulls the first Mermaid block out of Markdown and keeps other files whole", () => {
    const markdown = "# Notes\n\n```mermaid\nflowchart TD\n  a --> b\n```\n\n```mermaid\nflowchart LR\n```\n";
    expect(mermaidLanguage.fromStandalone(markdown)).toEqual({ code: "flowchart TD\n  a --> b" });
    expect(mermaidLanguage.fromStandalone("flowchart TD\n  a")).toEqual({ code: "flowchart TD\n  a" });
    expect(mermaidLanguage.fromFile("notes.MD", markdown)).toBe("flowchart TD\n  a --> b");
    expect(mermaidLanguage.fromFile("plain.markdown", "no diagrams here")).toBe("no diagrams here");
    expect(mermaidLanguage.fromFile("chart.mmd", markdown)).toBe(markdown);
  });

  it("fences inserted code and reads it back into a model", () => {
    expect(mermaidLanguage.insertText("flowchart TD\n  a --> b\n")).toBe("```mermaid\nflowchart TD\n  a --> b\n```\n");
    const read = mermaidLanguage.read("flowchart TD\n  a[Start] --> b[End]\n");
    expect(read.model?.nodes.map((node) => node.label)).toEqual(["Start", "End"]);
    expect(read.model?.edges).toHaveLength(1);
  });

  it("asks the fixer for Mermaid code with the render error", () => {
    const prompt = mermaidLanguage.fixPrompt("flowchart TD\n a -->", "Parse error on line 2");
    expect(prompt.system).toContain("Mermaid 11");
    expect(prompt.user).toContain("MERMAID ERROR:\nParse error on line 2");
  });
});

describe("Typst language", () => {
  it("refuses to read before the parser is loaded, then reads fletcher code", async () => {
    expect(typstLanguage.ready()).toBe(false);
    expect(() => typstLanguage.read("#diagram()")).toThrow("The Typst reader is not loaded yet.");
    await typstLanguage.load();
    expect(typstLanguage.ready()).toBe(true);
    const read = typstLanguage.read(typstLanguage.fileSource(MODEL));
    expect(read.model?.nodes.map((node) => node.label)).toEqual(["Start", "End"]);
  });

  it.each([
    [undefined, "#set page(width: auto, height: auto, margin: 4pt)"],
    [null, "#set page(width: auto, height: auto, margin: 4pt)"],
    ["transparent", "#set page(width: auto, height: auto, margin: 4pt)"],
    ["#ABCDEF", '#set page(width: auto, height: auto, margin: 4pt, fill: rgb("#abcdef"))'],
  ])("writes the page rule for background %j", (background, expected) => {
    expect(typstPageLine(background)).toBe(expected);
  });

  it("fills the preview page only for a hex background", () => {
    expect(typstPreviewDocument("#diagram()", "#FFFFFF")).toBe(
      '#set page(width: auto, height: auto, margin: 4pt, fill: rgb("#ffffff"))\n#diagram()',
    );
    expect(typstPreviewDocument("#diagram()", "transparent")).toBe(
      "#set page(width: auto, height: auto, margin: 4pt, fill: none)\n#diagram()",
    );
  });

  it("round-trips the standalone page rule and background", () => {
    const standalone = typstLanguage.standaloneSource({ ...MODEL, background: "#123456" });
    const [pageLine] = standalone.split("\n");
    expect(pageLine).toBe('#set page(width: auto, height: auto, margin: 4pt, fill: rgb("#123456"))');
    const back = typstLanguage.fromStandalone(standalone);
    expect(back.background).toBe("#123456");
    expect(back.code.startsWith("#import")).toBe(true);
    expect(readModelMark(back.code, "//")).toEqual({ ...MODEL, background: "#123456" });
  });

  it("reads a page rule without a fill and leaves other sources whole", () => {
    expect(typstLanguage.fromStandalone("#set page(width: auto, height: auto, margin: 4pt)\r\n#diagram()")).toEqual({
      code: "#diagram()",
    });
    expect(typstLanguage.fromStandalone("#diagram()\n")).toEqual({ code: "#diagram()\n" });
  });

  it("writes code for the requested Typst version and trims inserted code", () => {
    expect(typstLanguage.write(MODEL, { typstVersion: "0.13.1" })).toContain("@preview/fletcher:");
    expect(typstLanguage.fromFile("fig.typ", "#diagram()")).toBe("#diagram()");
    expect(typstLanguage.insertText("\n#diagram()\n\n")).toBe("#diagram()\n");
    const prompt = typstLanguage.fixPrompt("#diagram(", "error: unclosed delimiter");
    expect(prompt.user).toContain("TYPST ERRORS:\nerror: unclosed delimiter");
  });
});

describe("model marks", () => {
  it("embeds a model in a comment line and reads it back", () => {
    const source = `flowchart TD\n${modelMarkLine("%%", MODEL)}\n  a --> b`;
    expect(readModelMark(source, "%%")).toEqual(MODEL);
    expect(withoutModelMark(source, "%%")).toBe("flowchart TD\n  a --> b");
  });

  it("keeps Unicode labels intact through the mark", () => {
    const unicode: DiagramModel = { ...MODEL, nodes: [{ ...MODEL.nodes[0], label: "Größe → 東京" }] };
    expect(readModelMark(modelMarkLine("//", unicode), "//")).toEqual(unicode);
  });

  it.each([
    ["not base64", "%% oleafly-diagram-v1: !!!"],
    ["not JSON", `%% oleafly-diagram-v1: ${btoa("not json")}`],
    ["the wrong version", `%% oleafly-diagram-v1: ${btoa(JSON.stringify({ version: 2, nodes: [], edges: [] }))}`],
    ["missing nodes", `%% oleafly-diagram-v1: ${btoa(JSON.stringify({ version: 1, edges: [] }))}`],
    ["missing edges", `%% oleafly-diagram-v1: ${btoa(JSON.stringify({ version: 1, nodes: [] }))}`],
    ["null", `%% oleafly-diagram-v1: ${btoa("null")}`],
  ])("ignores a mark holding %s", (_reason, line) => {
    expect(readModelMark(`flowchart TD\n${line}`, "%%")).toBeNull();
  });

  it("ignores lines with another comment marker or no mark", () => {
    const line = modelMarkLine("//", MODEL);
    expect(readModelMark(line, "%%")).toBeNull();
    expect(readModelMark("%% just a note", "%%")).toBeNull();
    expect(withoutModelMark(`${line}\n%% just a note`, "%%")).toBe(`${line}\n%% just a note`);
  });
});
