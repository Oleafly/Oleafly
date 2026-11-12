import { describe, expect, it } from "vitest";
import { blockLine, tikzDocument, tikzFigure } from "./tikz-source";

function own(...lines: (number | null)[]) {
  return lines.map((line) => (line === null ? null : { line, shared: false }));
}

const PICTURE = String.raw`\usetikzlibrary{arrows.meta}
\tikzset{box/.style={draw}}

\begin{tikzpicture}
  \node[box] (a) {A};
\end{tikzpicture}
`;

describe("tikzDocument", () => {
  it("puts lines above the picture in the preamble and maps every line back to the block", () => {
    const document = tikzDocument(PICTURE, "tikz");
    expect(document.text).toBe(
      [
        String.raw`\documentclass[border=4pt]{standalone}`,
        String.raw`\usepackage{amsmath,amssymb}`,
        String.raw`\usepackage{tikz}`,
        String.raw`\usetikzlibrary{arrows.meta}`,
        String.raw`\tikzset{box/.style={draw}}`,
        "",
        String.raw`\begin{document}`,
        String.raw`\begin{tikzpicture}`,
        String.raw`  \node[box] (a) {A};`,
        String.raw`\end{tikzpicture}`,
        String.raw`\end{document}`,
        "",
      ].join("\n"),
    );
    expect(document.lines).toEqual(own(null, null, null, 1, 2, 3, null, 4, 5, 6, null));
    expect(blockLine(document, 9)).toEqual({ line: 5, shared: false });
    expect(blockLine(document, 3)).toBeNull();
    expect(blockLine(document, 40)).toBeNull();
  });

  it("wraps bare commands in the block's environment after the loader lines", () => {
    const document = tikzDocument("\r\n\\usetikzlibrary{calc}\r\n\\ctikzset{bipoles/length=1cm}\r\n\\draw (0,0) to[R] (2,0);\r\n", "circuitikz");
    const lines = document.text.split("\n");
    expect(lines.slice(2, 9)).toEqual([
      String.raw`\usepackage{circuitikz}`,
      "",
      String.raw`\usetikzlibrary{calc}`,
      String.raw`\begin{document}`,
      String.raw`\begin{circuitikz}`,
      String.raw`\ctikzset{bipoles/length=1cm}`,
      String.raw`\draw (0,0) to[R] (2,0);`,
    ]);
    expect(lines[9]).toBe(String.raw`\end{circuitikz}`);
    expect(document.lines.slice(3, 9)).toEqual(own(1, 2, null, null, 3, 4));
  });

  it("lets the block load its own package with options instead of the default", () => {
    const document = tikzDocument(String.raw`\usepackage[american, siunitx]{circuitikz}
\begin{circuitikz}\draw (0,0) to[R] (1,0);\end{circuitikz}`, "circuitikz");
    expect(document.text).not.toContain(String.raw`\usepackage{circuitikz}`);
    expect(document.text).toContain(String.raw`\usepackage[american, siunitx]{circuitikz}`);
    const tikz = tikzDocument(String.raw`\usepackage{pgfplots,tikz}
\draw (0,0) -- (1,1);`, "tikz");
    expect(tikz.text.match(/\\usepackage\{tikz\}/gu)).toBeNull();
  });

  it("keeps a block that has its own document body, and compiles a full document as written", () => {
    const body = tikzDocument(String.raw`\usetikzlibrary{calc}
\begin{document}
\begin{tikzpicture}\draw (0,0) -- (1,0);\end{tikzpicture}
\end{document}`, "tikz");
    expect(body.text).toContain(String.raw`\usetikzlibrary{calc}
\begin{document}
\begin{tikzpicture}`);
    expect(body.text.match(/\\begin\{document\}/gu)).toHaveLength(1);
    const whole = String.raw`\documentclass[tikz]{standalone}
\begin{document}
\tikz \draw (0,0) circle (1);
\end{document}`;
    const document = tikzDocument(`${whole}\r\n`, "tikz");
    expect(document.text).toBe(`${whole}\n`);
    expect(document.lines).toEqual(own(1, 2, 3, 4, 5));
  });

  it("puts the shared preamble before the block's own lines and marks where each came from", () => {
    const shared = String.raw`\usetikzlibrary{calc}

\tikzset{every node/.style={draw}}`;
    const document = tikzDocument(PICTURE, "tikz", shared);
    expect(document.text.split("\n").slice(3, 8)).toEqual([
      String.raw`\usetikzlibrary{calc}`,
      "",
      String.raw`\tikzset{every node/.style={draw}}`,
      String.raw`\usetikzlibrary{arrows.meta}`,
      String.raw`\tikzset{box/.style={draw}}`,
    ]);
    expect(document.lines.slice(3, 8)).toEqual([
      { line: 1, shared: true },
      { line: 2, shared: true },
      { line: 3, shared: true },
      { line: 1, shared: false },
      { line: 2, shared: false },
    ]);
    expect(tikzDocument(PICTURE, "tikz", " \n ").text).toBe(tikzDocument(PICTURE, "tikz").text);
  });

  it("lets the shared preamble load the package, and leaves full documents alone", () => {
    const circuit = tikzDocument(String.raw`\draw (0,0) to[R] (1,0);`, "circuitikz", String.raw`\usepackage[european]{circuitikz}`);
    expect(circuit.text).toContain(String.raw`\usepackage[european]{circuitikz}`);
    expect(circuit.text).not.toContain(String.raw`\usepackage{circuitikz}`);
    const whole = String.raw`\documentclass{standalone}
\begin{document}
x
\end{document}`;
    expect(tikzDocument(whole, "tikz", String.raw`\usetikzlibrary{calc}`).text).toBe(whole);
  });
});

describe("tikzFigure", () => {
  it("sends libraries before the figure, wraps bare commands and asks for the packages", () => {
    const figure = tikzFigure(String.raw`\usepackage[siunitx]{circuitikz}
\usepackage{xcolor}
  \usetikzlibrary{calc} % for coordinates
\ctikzset{resistors/scale=0.8}
\draw (0,0) to[R=$R$] (2,0);`, "circuitikz");
    expect(figure.packages).toEqual([
      { name: "circuitikz", options: "siunitx" },
      { name: "xcolor", options: "" },
    ]);
    expect(figure.lines).toEqual([
      String.raw`\usetikzlibrary{calc} % for coordinates`,
      String.raw`\begin{figure}[htbp]`,
      String.raw`  \centering`,
      String.raw`\begin{circuitikz}`,
      String.raw`\ctikzset{resistors/scale=0.8}`,
      String.raw`\draw (0,0) to[R=$R$] (2,0);`,
      String.raw`\end{circuitikz}`,
      String.raw`\end{figure}`,
    ]);
  });

  it("keeps a picture as written and asks for the block's package", () => {
    const figure = tikzFigure(PICTURE, "tikz");
    expect(figure.packages).toEqual([{ name: "tikz", options: "" }]);
    expect(figure.lines).toEqual([
      String.raw`\usetikzlibrary{arrows.meta}`,
      String.raw`\begin{figure}[htbp]`,
      String.raw`  \centering`,
      String.raw`\tikzset{box/.style={draw}}`,
      String.raw`\begin{tikzpicture}`,
      String.raw`  \node[box] (a) {A};`,
      String.raw`\end{tikzpicture}`,
      String.raw`\end{figure}`,
    ]);
  });

  it("adds the shared preamble to a figure sent to a paper", () => {
    const figure = tikzFigure(String.raw`\draw (0,0) -- (1,0);`, "tikz", String.raw`\usepackage{xcolor}
\usetikzlibrary{calc}
\tikzset{thick}`);
    expect(figure.packages).toEqual([
      { name: "tikz", options: "" },
      { name: "xcolor", options: "" },
    ]);
    expect(figure.lines.slice(0, 4)).toEqual([
      String.raw`\usetikzlibrary{calc}`,
      String.raw`\begin{figure}[htbp]`,
      String.raw`  \centering`,
      String.raw`\tikzset{thick}`,
    ]);
  });

  it("takes the body of a full document and drops its class", () => {
    const figure = tikzFigure(String.raw`\documentclass[tikz]{standalone}
\usepackage{amsmath}
\begin{document}
\begin{tikzpicture}\draw (0,0) -- (1,0);\end{tikzpicture}
\end{document}`, "tikz");
    expect(figure.packages).toEqual([
      { name: "tikz", options: "" },
      { name: "amsmath", options: "" },
    ]);
    expect(figure.lines.join("\n")).not.toContain("documentclass");
    expect(figure.lines).toContain(String.raw`\begin{tikzpicture}\draw (0,0) -- (1,0);\end{tikzpicture}`);
  });
});
