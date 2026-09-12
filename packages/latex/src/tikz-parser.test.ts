import { describe, expect, it } from "vitest";
import { diagramFromSource, importTikz, parseTikz, sameDiagramModel } from "./tikz-parser";
import { modelToTikz, serializeDiagram } from "./tikz-serializer";
import type { DiagramModel } from "./model";

const ISSUE_SNIPPET = String.raw`\begin{tikzpicture}[
    node distance=1.5cm,
    box/.style={rectangle, draw, rounded corners, minimum width=2cm, minimum height=1cm, fill=blue!10},
    arrow/.style={-Stealth, thick}
]
% Nodes
\node[box] (input) {Input};
\node[box, right=of input] (process) {Process};
\node[box, right=of process] (output) {Output};
\node[diamond, draw, aspect=2, minimum width=2cm, minimum height=1cm, fill=orange!10, below=of process] (decision) {Decision?};
% Arrows
\draw[arrow] (input) -- (process);
\draw[arrow] (process) -- (output);
\draw[arrow] (process) -- (decision);
\draw[arrow] (decision) -| node[above, near start] {Yes} (output);
\draw[arrow] (decision) -- ++(-2,0) |- node[left, near start] {No} (input);
\end{tikzpicture}`;

function node(model: DiagramModel, id: string) {
  const found = model.nodes.find((entry) => entry.id === id);
  if (!found) throw new Error(`no node ${id} in ${model.nodes.map((n) => n.id).join(", ")}`);
  return found;
}

function edge(model: DiagramModel, source: string, target: string) {
  const found = model.edges.find((entry) => entry.source === source && entry.target === target);
  if (!found) throw new Error(`no edge ${source}->${target}`);
  return found;
}

describe("parseTikz on the reported snippet", () => {
  const parsed = parseTikz(ISSUE_SNIPPET);
  if (!parsed) throw new Error("parseTikz returned null for the reported snippet");
  const model = parsed;

  it("reads every node with its shape, label and explicit size", () => {
    expect(model).not.toBeNull();
    expect(model.nodes.map((n) => n.id)).toEqual(["input", "process", "output", "decision"]);
    expect(node(model, "input").label).toBe("Input");
    expect(node(model, "decision").shape).toBe("diamond");
    expect(node(model, "input").shape).toBe("roundrect");
    for (const id of ["input", "process", "output", "decision"]) {
      expect(node(model, id).w).toBe(80);
      expect(node(model, id).h).toBe(40);
    }
  });

  it("resolves the mixed fills the styles declare", () => {
    expect(node(model, "input").fill).toBe("#e6e6ff");
    expect(node(model, "decision").fill).toBe("#fff2e6");
  });

  it("lays the chain out from the relative placements", () => {
    const input = node(model, "input");
    const process = node(model, "process");
    const output = node(model, "output");
    const decision = node(model, "decision");
    expect(process.y).toBe(input.y);
    expect(output.y).toBe(input.y);
    expect(process.x - (input.x + input.w)).toBe(60);
    expect(output.x - (process.x + process.w)).toBe(60);
    expect(decision.x).toBe(process.x);
    expect(decision.y - (process.y + process.h)).toBe(60);
  });

  it("reads the arrows, including the orthogonal ones and their labels", () => {
    expect(model.edges).toHaveLength(5);
    expect(edge(model, "input", "process")).toMatchObject({
      routing: "straight",
      arrow: "forward",
      sourceHandle: "r",
      targetHandle: "l",
    });
    expect(edge(model, "process", "decision")).toMatchObject({
      sourceHandle: "b",
      targetHandle: "t",
    });
    expect(edge(model, "decision", "output")).toMatchObject({
      routing: "orthogonal",
      label: "Yes",
      sourceHandle: "r",
      targetHandle: "b",
    });
    expect(edge(model, "decision", "input")).toMatchObject({
      routing: "orthogonal",
      label: "No",
      sourceHandle: "l",
      targetHandle: "r",
    });
  });
});

describe("round trip through the app's own serializer", () => {
  const original: DiagramModel = {
    version: 1,
    nodes: [
      {
        id: "a",
        shape: "rectangle",
        x: 40,
        y: 40,
        w: 160,
        h: 60,
        label: "Alpha",
        fill: "#cfe8f8",
        stroke: "#1e293b",
        strokeStyle: "solid",
        strokeWidth: 1,
        fontSize: 10,
        fontFamily: "sans",
      },
      {
        id: "b",
        shape: "diamond",
        x: 320,
        y: 40,
        w: 120,
        h: 80,
        label: "Beta?",
        fill: "#fde3c7",
        stroke: "#1e293b",
        strokeStyle: "dashed",
        strokeWidth: 1,
        fontSize: 12,
        fontFamily: "serif",
      },
      {
        id: "c",
        shape: "circle",
        x: 40,
        y: 220,
        w: 90,
        h: 90,
        label: "Gamma",
        stroke: "#1e293b",
        strokeStyle: "solid",
        strokeWidth: 1,
        fontSize: 10,
        fontFamily: "mono",
      },
    ],
    edges: [
      { id: "e1", source: "a", target: "b", routing: "straight", arrow: "forward", style: "solid", sourceHandle: "r", targetHandle: "l" },
      { id: "e2", source: "a", target: "c", routing: "orthogonal", arrow: "both", style: "dashed", label: "loop", sourceHandle: "b", targetHandle: "t" },
      { id: "e3", source: "b", target: "c", routing: "curved", arrow: "none", style: "dotted", sourceHandle: "b", targetHandle: "r" },
    ],
  };

  it("re-reads geometry, colours and fonts from plain TikZ", () => {
    const parsed = parseTikz(modelToTikz(original));
    expect(parsed).not.toBeNull();
    if (!parsed) return;
    for (const source of original.nodes) {
      expect(node(parsed, source.id)).toMatchObject({
        shape: source.shape,
        x: source.x,
        y: source.y,
        w: source.w,
        h: source.h,
        label: source.label,
        stroke: source.stroke,
        fontSize: source.fontSize,
        fontFamily: source.fontFamily,
      });
    }
    expect(node(parsed, "a").fill).toBe("#cfe8f8");
    expect(node(parsed, "b").strokeStyle).toBe("dashed");
  });

  it("recovers the edges, including the orthogonal one drawn as bare coordinates", () => {
    const parsed = parseTikz(modelToTikz(original));
    if (!parsed) return;
    expect(parsed.edges).toHaveLength(3);
    expect(edge(parsed, "a", "b")).toMatchObject({ routing: "straight", arrow: "forward" });
    expect(edge(parsed, "a", "c")).toMatchObject({
      routing: "orthogonal",
      arrow: "both",
      style: "dashed",
      label: "loop",
      sourceHandle: "b",
      targetHandle: "t",
    });
    expect(edge(parsed, "b", "c")).toMatchObject({ routing: "curved", arrow: "none", style: "dotted" });
  });

  it("does not leave the orthogonal label behind as a shape", () => {
    const parsed = parseTikz(modelToTikz(original));
    expect(parsed?.nodes).toHaveLength(3);
  });

  it("prefers the embedded model when the visible TikZ still matches it", () => {
    const adopted = diagramFromSource(serializeDiagram(original));
    expect(adopted?.nodes.map((n) => n.id)).toEqual(["a", "b", "c"]);
    expect(adopted?.edges.map((e) => e.id)).toEqual(["e1", "e2", "e3"]);
  });

  it("prefers the visible TikZ once it has been edited away from the marker", () => {
    const edited = serializeDiagram(original).replace("{Alpha}", "{Edited}");
    const adopted = diagramFromSource(edited);
    expect(node(adopted as DiagramModel, "a").label).toBe("Edited");
  });

  it("falls back to the marker when the visible TikZ carries no shapes", () => {
    const stripped = `\\begin{tikzpicture}\n\\end{tikzpicture}\n${serializeDiagram(original).split("\n").pop()}`;
    expect(diagramFromSource(stripped)?.nodes).toHaveLength(3);
  });
});

describe("node syntax", () => {
  it("accepts options before and after the position", () => {
    const before = parseTikz(String.raw`\node[draw] (a) at (1,2) {A};`);
    const after = parseTikz(String.raw`\node (a) at (1,2) [draw] {A};`);
    expect(before?.nodes[0].label).toBe("A");
    expect(after?.nodes[0].label).toBe("A");
    expect(before?.nodes[0].x).toBe(after?.nodes[0].x);
  });

  it("maps TikZ centres in cm onto model top-left pixels", () => {
    const model = parseTikz(String.raw`
      \node[draw, minimum width=2cm, minimum height=1cm] (a) at (0,0) {A};
      \node[draw, minimum width=2cm, minimum height=1cm] (b) at (3,-1) {B};
    `);
    if (!model) throw new Error("no model");
    expect(node(model, "b").x - node(model, "a").x).toBe(120);
    expect(node(model, "b").y - node(model, "a").y).toBe(40);
  });

  it("reads coordinates in explicit units", () => {
    const model = parseTikz(String.raw`
      \node (a) at (0cm,0cm) {A};
      \node (b) at (10mm,0cm) {B};
    `);
    if (!model) throw new Error("no model");
    expect(node(model, "b").x - node(model, "a").x).toBe(40);
  });

  it("keeps math and escaped characters in labels", () => {
    const model = parseTikz(String.raw`\node (a) at (0,0) {$x_i$ 50\% \& more};`);
    expect(model?.nodes[0].label).toBe("$x_i$ 50% & more");
  });

  it("names unnamed nodes without colliding", () => {
    const model = parseTikz(String.raw`
      \node at (0,0) {First};
      \node at (2,0) {Second};
    `);
    expect(model?.nodes).toHaveLength(2);
    expect(new Set(model?.nodes.map((n) => n.id)).size).toBe(2);
  });

  it("treats an undrawn, unfilled node as text", () => {
    expect(parseTikz(String.raw`\node (a) at (0,0) {Title};`)?.nodes[0].shape).toBe("text");
  });

  it("keeps coordinates out of the shape list", () => {
    const model = parseTikz(String.raw`
      \coordinate (helper) at (1,1);
      \node[draw] (a) at (0,0) {A};
    `);
    expect(model?.nodes.map((n) => n.id)).toEqual(["a"]);
  });
});

describe("relative placement", () => {
  it("honours an explicit distance over the picture default", () => {
    const model = parseTikz(String.raw`\begin{tikzpicture}[node distance=1cm]
      \node[draw, minimum width=1cm, minimum height=1cm] (a) {A};
      \node[draw, minimum width=1cm, minimum height=1cm, right=3cm of a] (b) {B};
    \end{tikzpicture}`);
    if (!model) throw new Error("no model");
    expect(node(model, "b").x - (node(model, "a").x + node(model, "a").w)).toBe(120);
  });

  it("reads the vertical-and-horizontal form of node distance", () => {
    const model = parseTikz(String.raw`\begin{tikzpicture}[node distance=2cm and 1cm]
      \node[draw, minimum width=1cm, minimum height=1cm] (a) {A};
      \node[draw, minimum width=1cm, minimum height=1cm, right=of a] (b) {B};
      \node[draw, minimum width=1cm, minimum height=1cm, below=of a] (c) {C};
    \end{tikzpicture}`);
    if (!model) throw new Error("no model");
    expect(node(model, "b").x - (node(model, "a").x + node(model, "a").w)).toBe(40);
    expect(node(model, "c").y - (node(model, "a").y + node(model, "a").h)).toBe(80);
  });

  it("resolves a chain that refers forward to a later node", () => {
    const model = parseTikz(String.raw`\begin{tikzpicture}[node distance=1cm]
      \node[draw, minimum width=1cm, minimum height=1cm, right=of anchor] (b) {B};
      \node[draw, minimum width=1cm, minimum height=1cm] (anchor) at (0,0) {A};
    \end{tikzpicture}`);
    if (!model) throw new Error("no model");
    expect(node(model, "b").x).toBeGreaterThan(node(model, "anchor").x);
  });

  it("places diagonal directions on both axes", () => {
    const model = parseTikz(String.raw`\begin{tikzpicture}[node distance=1cm]
      \node[draw, minimum width=1cm, minimum height=1cm] (a) at (0,0) {A};
      \node[draw, minimum width=1cm, minimum height=1cm, below right=of a] (b) {B};
    \end{tikzpicture}`);
    if (!model) throw new Error("no model");
    expect(node(model, "b").x).toBeGreaterThan(node(model, "a").x);
    expect(node(model, "b").y).toBeGreaterThan(node(model, "a").y);
  });

  it("keeps unrelated components apart instead of stacking them", () => {
    const model = parseTikz(String.raw`
      \node[draw] (a) {A};
      \node[draw] (b) {B};
    `);
    if (!model) throw new Error("no model");
    expect(node(model, "a").y).not.toBe(node(model, "b").y);
  });
});

describe("styles, colours and strokes", () => {
  it("expands a style that references another style", () => {
    const model = parseTikz(String.raw`\begin{tikzpicture}[
      base/.style={draw, minimum width=2cm},
      box/.style={base, fill=red}
    ]
      \node[box] (a) at (0,0) {A};
    \end{tikzpicture}`);
    expect(model?.nodes[0].w).toBe(80);
    expect(model?.nodes[0].fill).toBe("#ff0000");
  });

  it("applies every node styles", () => {
    const model = parseTikz(String.raw`\begin{tikzpicture}[every node/.style={draw, fill=teal}]
      \node (a) at (0,0) {A};
    \end{tikzpicture}`);
    expect(model?.nodes[0].fill).toBe("#008080");
  });

  it("reads tikzset and the deprecated tikzstyle form", () => {
    const set = parseTikz(String.raw`\tikzset{box/.style={draw, fill=lime}}
      \begin{tikzpicture}\node[box] (a) at (0,0) {A};\end{tikzpicture}`);
    expect(set?.nodes[0].fill).toBe("#bfff00");
    const style = parseTikz(String.raw`\tikzstyle{box}=[draw, fill=olive]
      \begin{tikzpicture}\node[box] (a) at (0,0) {A};\end{tikzpicture}`);
    expect(style?.nodes[0].fill).toBe("#808000");
  });

  it("mixes colours the way xcolor does", () => {
    const model = parseTikz(String.raw`
      \node[draw, fill=blue!10] (a) at (0,0) {A};
      \node[draw, fill=black!50!white] (b) at (3,0) {B};
      \node[draw, fill=white] (c) at (6,0) {C};
    `);
    if (!model) throw new Error("no model");
    expect(node(model, "a").fill).toBe("#e6e6ff");
    expect(node(model, "b").fill).toBe("#808080");
    expect(node(model, "c").fill).toBe("#ffffff");
  });

  it("resolves colours defined before the picture", () => {
    const model = parseTikz(String.raw`\definecolor{cAABBCC}{HTML}{AABBCC}
      \begin{tikzpicture}\node[draw, fill=cAABBCC] (a) at (0,0) {A};\end{tikzpicture}`);
    expect(model?.nodes[0].fill).toBe("#aabbcc");
  });

  it("reads dashed and dotted strokes", () => {
    const model = parseTikz(String.raw`
      \node[draw, dashed] (a) at (0,0) {A};
      \node[draw, dotted] (b) at (3,0) {B};
    `);
    if (!model) throw new Error("no model");
    expect(node(model, "a").strokeStyle).toBe("dashed");
    expect(node(model, "b").strokeStyle).toBe("dotted");
  });

  it("reads font family and size", () => {
    const model = parseTikz(
      String.raw`\node[draw, font=\sffamily\fontsize{14}{16}\selectfont] (a) at (0,0) {A};`,
    );
    expect(model?.nodes[0].fontFamily).toBe("sans");
    expect(model?.nodes[0].fontSize).toBe(14);
  });
});

describe("paths", () => {
  const two = String.raw`\node[draw] (a) at (0,0) {A};\node[draw] (b) at (4,0) {B};`;

  it("reads arrow directions, including a reversed one", () => {
    expect(parseTikz(`${two}\\draw[->] (a) -- (b);`)?.edges[0]).toMatchObject({
      source: "a",
      target: "b",
      arrow: "forward",
    });
    expect(parseTikz(`${two}\\draw[<->] (a) -- (b);`)?.edges[0].arrow).toBe("both");
    expect(parseTikz(`${two}\\draw (a) -- (b);`)?.edges[0].arrow).toBe("none");
    expect(parseTikz(`${two}\\draw[<-] (a) -- (b);`)?.edges[0]).toMatchObject({
      source: "b",
      target: "a",
      arrow: "forward",
    });
  });

  it("reads decorated arrow tips", () => {
    expect(parseTikz(`${two}\\draw[-Stealth] (a) -- (b);`)?.edges[0].arrow).toBe("forward");
    expect(
      parseTikz(`${two}\\draw[-{Triangle[length=0.313cm,width=0.313cm]}] (a) -- (b);`)?.edges[0]
        .arrow,
    ).toBe("forward");
  });

  it("splits a multi-segment path into one edge per hop", () => {
    const model = parseTikz(
      String.raw`\node[draw] (a) at (0,0) {A};\node[draw] (b) at (4,0) {B};\node[draw] (c) at (8,0) {C};
      \draw[->] (a) -- (b) -- (c);`,
    );
    expect(model?.edges).toHaveLength(2);
    expect(model?.edges[1]).toMatchObject({ source: "b", target: "c" });
  });

  it("marks a to[out=..,in=..] hop as curved", () => {
    const model = parseTikz(`${two}\\draw[->] (a) to[out=90,in=90] (b);`);
    expect(model?.edges[0].routing).toBe("curved");
  });

  it("takes handles from explicit anchors", () => {
    const model = parseTikz(`${two}\\draw[->] (a.north) -- (b.south);`);
    expect(model?.edges[0]).toMatchObject({ sourceHandle: "t", targetHandle: "b" });
  });

  it("reads an edge label written as a path node", () => {
    const model = parseTikz(`${two}\\draw[->] (a) -- node[midway] {weight} (b);`);
    expect(model?.edges[0].label).toBe("weight");
  });

  it("carries the path style onto the edge", () => {
    const model = parseTikz(`${two}\\draw[->, dashed] (a) -- (b);`);
    expect(model?.edges[0].style).toBe("dashed");
  });

  it("drops an edge that names a node the picture never defines", () => {
    const model = parseTikz(`${two}\\draw[->] (a) -- (ghost);`);
    expect(model?.edges).toHaveLength(0);
  });

  it("ignores a path with no node endpoints at all", () => {
    const model = parseTikz(`${two}\\draw (0,-4) -- (4,-4);`);
    expect(model?.edges).toHaveLength(0);
  });
});

describe("robustness", () => {
  it("returns null when there is nothing to draw", () => {
    expect(parseTikz("")).toBeNull();
    expect(parseTikz("just prose")).toBeNull();
    expect(parseTikz(String.raw`\begin{tikzpicture}\end{tikzpicture}`)).toBeNull();
  });

  it("survives unbalanced and unterminated input", () => {
    expect(() => parseTikz(String.raw`\node[draw] (a) at (0,0) {A`)).not.toThrow();
    expect(() => parseTikz(String.raw`\begin{tikzpicture}\node (a) {A};`)).not.toThrow();
    expect(() => parseTikz(String.raw`\node[[[[ (a) {A};`)).not.toThrow();
  });

  it("reads a picture wrapped in a full document", () => {
    const model = parseTikz(String.raw`\documentclass{standalone}
\usepackage{tikz}
\begin{document}
\begin{tikzpicture}
\node[draw] (a) at (0,0) {A};
\end{tikzpicture}
\end{document}`);
    expect(model?.nodes).toHaveLength(1);
  });

  it("ignores commented-out shapes but keeps escaped percent signs", () => {
    const model = parseTikz(String.raw`
      % \node[draw] (ghost) at (0,0) {Ghost};
      \node[draw] (a) at (0,0) {100\% done};
    `);
    expect(model?.nodes).toHaveLength(1);
    expect(model?.nodes[0].label).toBe("100% done");
  });

  it("handles Windows line endings", () => {
    const model = parseTikz("\\node[draw] (a) at (0,0) {A};\r\n\\node[draw] (b) at (3,0) {B};\r\n");
    expect(model?.nodes).toHaveLength(2);
  });

  it("keeps a semicolon that appears inside a label", () => {
    const model = parseTikz(String.raw`\node[draw] (a) at (0,0) {one; two};`);
    expect(model?.nodes[0].label).toBe("one; two");
  });

  it("reports constructs it could not draw", () => {
    const { unsupported } = importTikz(String.raw`\begin{tikzpicture}
      \node[draw] (a) at (0,0) {A};
      \foreach \i in {1,2,3} { \node at (\i,0) {\i}; }
    \end{tikzpicture}`);
    expect(unsupported).toContain("foreach");
  });

  it("stays fast on a large picture", () => {
    const lines: string[] = [];
    for (let i = 0; i < 600; i++) {
      lines.push(`\\node[draw] (n${i}) at (${i % 30},${-Math.floor(i / 30)}) {Node ${i}};`);
    }
    for (let i = 1; i < 600; i++) lines.push(`\\draw[->] (n${i - 1}) -- (n${i});`);
    const source = `\\begin{tikzpicture}\n${lines.join("\n")}\n\\end{tikzpicture}`;
    const started = Date.now();
    const model = parseTikz(source);
    expect(Date.now() - started).toBeLessThan(4000);
    expect(model?.nodes.length).toBe(600);
  });
});

describe("sameDiagramModel", () => {
  const base: DiagramModel = {
    version: 1,
    nodes: [{ id: "a", shape: "rectangle", x: 0, y: 0, w: 10, h: 10, label: "A" }],
    edges: [],
  };

  it("ignores absent optional fields that default to the same value", () => {
    expect(sameDiagramModel(base, { ...base, nodes: [{ ...base.nodes[0], strokeStyle: "solid" }] })).toBe(true);
  });

  it("sees a moved node", () => {
    expect(sameDiagramModel(base, { ...base, nodes: [{ ...base.nodes[0], x: 40 }] })).toBe(false);
  });

  it("sees an added edge", () => {
    expect(
      sameDiagramModel(base, {
        ...base,
        edges: [{ id: "e", source: "a", target: "a", routing: "straight", arrow: "none", style: "solid" }],
      }),
    ).toBe(false);
  });
});

describe("path semantics", () => {
  const grid = String.raw`\node[draw] (a) at (0,0) {A};\node[draw] (b) at (4,0) {B};\node[draw] (c) at (0,-4) {C};\node[draw] (d) at (4,-4) {D};`;

  it("fans every edge out of the same source", () => {
    const model = parseTikz(
      `${grid}\\path[->] (a) edge node {0} (b) edge node {1} (c);`,
    );
    expect(model?.edges.map((e) => [e.source, e.target])).toEqual([
      ["a", "b"],
      ["a", "c"],
    ]);
    expect(model?.edges.map((e) => e.label)).toEqual(["0", "1"]);
  });

  it("gives each edge its own options", () => {
    const model = parseTikz(`${grid}\\path (a) edge[->] (b) edge[dashed] (c);`);
    if (!model) throw new Error("no model");
    expect(edge(model, "a", "b")).toMatchObject({ arrow: "forward", style: "solid" });
    expect(edge(model, "a", "c")).toMatchObject({ arrow: "none", style: "dashed" });
  });

  it("leaves horizontally for -| and vertically for |-", () => {
    const horizontal = parseTikz(
      String.raw`\node[draw] (a) at (0,0) {A};\node[draw] (b) at (1,-4) {B};\draw[->] (a) -| (b);`,
    );
    expect(horizontal?.edges[0]).toMatchObject({ sourceHandle: "r", targetHandle: "t" });
    const vertical = parseTikz(
      String.raw`\node[draw] (dec) at (0,-6) {D};\node[draw] (start) at (2,0) {S};\draw[->] (dec) |- (start);`,
    );
    expect(vertical?.edges[0]).toMatchObject({ sourceHandle: "t", targetHandle: "l" });
  });

  it("starts a new subpath at a move-to instead of joining the parts", () => {
    const model = parseTikz(`${grid}\\draw[->] (a) -- (b) (c) -- (d);`);
    expect(model?.edges.map((e) => [e.source, e.target])).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("closes a subpath on cycle", () => {
    const model = parseTikz(`${grid}\\draw[->] (a) -- (b) -- (d) -- cycle;`);
    expect(model?.edges.map((e) => [e.source, e.target])).toEqual([
      ["a", "b"],
      ["b", "d"],
      ["d", "a"],
    ]);
  });

  it("reads a Bezier segment as a curve, not a staircase", () => {
    const model = parseTikz(
      String.raw`\node[draw] (a) at (0,0) {A};\node[draw] (b) at (4,0) {B};\draw[->] (a) .. controls (1,2) and (3,2) .. (b);`,
    );
    expect(model?.edges[0].routing).toBe("curved");
  });

  it("takes the bend of a to[out=..,in=..] from its angles", () => {
    const model = parseTikz(
      String.raw`\node[draw] (a) at (0,0) {A};\node[draw] (b) at (4,0) {B};\draw[->] (a) to[out=90,in=90] (b);`,
    );
    expect(model?.edges[0]).toMatchObject({ sourceHandle: "t", targetHandle: "t" });
    const under = parseTikz(
      String.raw`\node[draw] (a) at (0,0) {A};\node[draw] (b) at (4,0) {B};\draw[->] (a) to[out=-90,in=-90] (b);`,
    );
    expect(under?.edges[0]).toMatchObject({ sourceHandle: "b", targetHandle: "b" });
  });

  it("does not mistake a hyphenated style name for an arrow tip", () => {
    const model = parseTikz(`${grid}\\draw[data-flow, thick] (a) -- (b);`);
    expect(model?.edges[0].arrow).toBe("none");
    const named = parseTikz(`${grid}\\draw[->, my-style] (a) -- (b);`);
    expect(named?.edges[0].arrow).toBe("forward");
  });

  it("reads bar tips as decoration rather than arrowheads", () => {
    expect(parseTikz(`${grid}\\draw[|->] (a) -- (b);`)?.edges[0].arrow).toBe("forward");
    expect(parseTikz(`${grid}\\draw[|-|] (a) -- (b);`)?.edges[0].arrow).toBe("none");
  });

  it("keeps a plus hop relative to the segment start", () => {
    const model = parseTikz(
      String.raw`\node[draw] (a) at (0,0) {A};\node[draw] (b) at (3,0) {B};\draw[->] (a) -- +(0,3) -- +(3,-1) -- (b);`,
    );
    expect(model?.edges[0].targetHandle).toBe("b");
  });

  it("ignores shape operations that are not connectors", () => {
    expect(parseTikz(`${grid}\\draw (a) rectangle (d);`)?.edges).toHaveLength(0);
    expect(parseTikz(`${grid}\\draw (a) circle (1cm);`)?.edges).toHaveLength(0);
  });

  it("paints nothing for a bare path", () => {
    expect(parseTikz(`${grid}\\path (a) -- (b);`)?.edges).toHaveLength(0);
    expect(parseTikz(`${grid}\\path[draw] (a) -- (b);`)?.edges).toHaveLength(1);
  });

  it("promotes a named node written on a path to a real node", () => {
    const model = parseTikz(
      String.raw`\node[draw] (a) at (0,0) {A};\node[draw] (b) at (6,0) {B};\node[draw] (c) at (3,-4) {C};
      \draw (a) -- node[draw] (m) {M} (b);
      \draw[->] (m) -- (c);`,
    );
    if (!model) throw new Error("no model");
    expect(node(model, "m").label).toBe("M");
    expect(edge(model, "m", "c")).toBeTruthy();
    expect(edge(model, "a", "b").label).toBeUndefined();
  });

  it("reads a tikzset that has no trailing semicolon", () => {
    const model = parseTikz(
      String.raw`\tikzset{my-arrow/.style={->, thick}}
      \node[draw] (a) at (0,0) {A};
      \node[draw] (b) at (4,0) {B};
      \draw[my-arrow] (a) -- (b);`,
    );
    expect(model?.nodes.map((n) => n.id)).toEqual(["a", "b"]);
    expect(model?.edges[0].arrow).toBe("forward");
  });
});

describe("document context", () => {
  it("reads styles declared in the document preamble", () => {
    const model = parseTikz(String.raw`\documentclass{article}
\usepackage{tikz}
\usetikzlibrary{shapes.geometric, arrows}
\tikzstyle{startstop} = [rectangle, rounded corners, minimum width=3cm, minimum height=1cm, draw=black, fill=red!30]
\tikzstyle{process} = [rectangle, minimum width=3cm, minimum height=1cm, draw=black, fill=orange!30]
\begin{document}
\begin{tikzpicture}
\node (start) [startstop] {Start};
\node (proc) [process, below=of start] {Process};
\end{tikzpicture}
\end{document}`);
    if (!model) throw new Error("no model");
    expect(node(model, "start")).toMatchObject({ shape: "roundrect", fill: "#ffb3b3", w: 120, h: 40 });
    expect(node(model, "proc")).toMatchObject({ shape: "rectangle", fill: "#ffd9b3" });
  });

  it("reads every style declaration, not just the first", () => {
    const model = parseTikz(String.raw`\tikzset{box/.style={draw, fill=olive}}
\tikzset{blob/.style={draw, fill=red}}
\begin{tikzpicture}\node[box] (a) at (0,0) {A};\node[blob] (b) at (3,0) {B};\end{tikzpicture}`);
    if (!model) throw new Error("no model");
    expect(node(model, "a").fill).toBe("#808000");
    expect(node(model, "b").fill).toBe("#ff0000");
  });

  it("keeps the node that follows a style declaration with no semicolon", () => {
    const model = parseTikz(String.raw`\begin{tikzpicture}
\tikzstyle{box}=[draw, fill=red]
\node[box] (a) at (0,0) {FIRST};
\node[box] (b) at (5,0) {SECOND};
\end{tikzpicture}`);
    expect(model?.nodes.map((n) => n.label)).toEqual(["FIRST", "SECOND"]);
  });

  it("inherits the picture's own options", () => {
    const model = parseTikz(String.raw`\begin{tikzpicture}[draw=red, font=\sffamily, thick]
\node (a) at (0,0) {A};
\end{tikzpicture}`);
    expect(model?.nodes[0]).toMatchObject({ stroke: "#ff0000", fontFamily: "sans" });
  });

  it("separates the RGB and rgb colour models", () => {
    const model = parseTikz(String.raw`\definecolor{cA}{RGB}{0,102,204}
\definecolor{cB}{rgb}{0,0.4,0.8}
\begin{tikzpicture}
\node[draw, fill=cA] (a) at (0,0) {A};
\node[draw, fill=cB] (b) at (3,0) {B};
\end{tikzpicture}`);
    if (!model) throw new Error("no model");
    expect(node(model, "a").fill).toBe("#0066cc");
    expect(node(model, "b").fill).toBe("#0066cc");
  });

  it("takes the figure background from the page colour", () => {
    expect(
      parseTikz(String.raw`\pagecolor{white}\begin{tikzpicture}\node[draw] (a) at (0,0) {A};\end{tikzpicture}`)
        ?.background,
    ).toBe("#ffffff");
    // A whole document with no page colour is transparent on purpose.
    expect(
      parseTikz(String.raw`\begin{document}\begin{tikzpicture}\node[draw] (a) at (0,0) {A};\end{tikzpicture}\end{document}`)
        ?.background,
    ).toBe("");
    // A bare snippet says nothing about the page, so the caller keeps its own.
    expect(
      parseTikz(String.raw`\begin{tikzpicture}\node[draw] (a) at (0,0) {A};\end{tikzpicture}`)?.background,
    ).toBeUndefined();
  });
});

describe("placement forms", () => {
  const boxes = String.raw`\node[draw, minimum width=1cm, minimum height=1cm] `;

  it("reads the legacy centre-to-centre form", () => {
    const model = parseTikz(String.raw`\begin{tikzpicture}[node distance=2cm]
${boxes}(a) at (0,0) {A};
${boxes}(b) [above of=a] {B};
\end{tikzpicture}`);
    if (!model) throw new Error("no model");
    const a = node(model, "a");
    const b = node(model, "b");
    expect(a.y - b.y).toBe(80);
    expect(b.x).toBe(a.x);
  });

  it("treats of X.anchor as the reference point itself", () => {
    const model = parseTikz(String.raw`\begin{tikzpicture}
\node[draw, minimum width=4cm, minimum height=1cm] (a) at (0,0) {A};
${boxes}(b) [right=of a.east] {B};
\end{tikzpicture}`);
    if (!model) throw new Error("no model");
    expect(node(model, "b").x - (node(model, "a").x + node(model, "a").w)).toBe(40);
  });

  it("reads node distance from a scope and from the node itself", () => {
    const scoped = parseTikz(String.raw`\begin{tikzpicture}
\begin{scope}[node distance=3cm]
${boxes}(a) at (0,0) {A};
${boxes}(b) [right=of a] {B};
\end{scope}
\end{tikzpicture}`);
    if (!scoped) throw new Error("no model");
    expect(node(scoped, "b").x - (node(scoped, "a").x + node(scoped, "a").w)).toBe(120);

    const inline = parseTikz(String.raw`\begin{tikzpicture}
${boxes}(a) at (0,0) {A};
\node[draw, minimum width=1cm, minimum height=1cm, node distance=3cm, right=of a] (b) {B};
\end{tikzpicture}`);
    if (!inline) throw new Error("no model");
    expect(node(inline, "b").x - (node(inline, "a").x + node(inline, "a").w)).toBe(120);
  });

  it("reads the inline vertical-and-horizontal distance", () => {
    const model = parseTikz(String.raw`\begin{tikzpicture}
${boxes}(a) at (0,0) {A};
${boxes}(b) [above right=1cm and 3cm of a] {B};
\end{tikzpicture}`);
    if (!model) throw new Error("no model");
    const a = node(model, "a");
    const b = node(model, "b");
    expect(b.x - (a.x + a.w)).toBe(120);
    expect(a.y - (b.y + b.h)).toBe(40);
  });

  it("never mints an id an explicit name already uses", () => {
    const model = parseTikz(String.raw`\begin{tikzpicture}
\node[draw] (node1) at (0,0) {First};
\node[draw] at (3,0) {Second};
\end{tikzpicture}`);
    if (!model) throw new Error("no model");
    expect(new Set(model.nodes.map((n) => n.id)).size).toBe(2);
    expect(node(model, "node1").label).toBe("First");
  });
});

describe("degenerate input", () => {
  it("loses only the statement that carries an unbalanced brace", () => {
    const model = parseTikz(String.raw`\node[draw] (a) at (0,0) {broken {label};
\node[draw] (b) at (3,0) {B};
\node[draw] (c) at (6,0) {C};`);
    expect(model?.nodes.map((n) => n.label)).toContain("B");
    expect(model?.nodes.map((n) => n.label)).toContain("C");
  });

  it("says so when a picture is too large to read whole", () => {
    const lines: string[] = [];
    for (let i = 0; i < 21000; i++) lines.push(`\\node[draw] (n${i}) at (${i % 50},${-i}) {N};`);
    const { unsupported } = importTikz(`\\begin{tikzpicture}\n${lines.join("\n")}\n\\end{tikzpicture}`);
    expect(unsupported).toContain("truncated");
  });
});

describe("option details", () => {
  it("reads the relative font size commands", () => {
    const sizes: Record<string, number> = {
      "\\tiny": 5,
      "\\scriptsize": 7,
      "\\footnotesize": 8,
      "\\small": 9,
      "\\large": 12,
      "\\Large": 14,
      "\\LARGE": 17,
      "\\huge": 20,
      "\\Huge": 25,
    };
    for (const [command, size] of Object.entries(sizes)) {
      const model = parseTikz(`\\node[draw, font=${command}] (a) at (0,0) {A};`);
      expect(model?.nodes[0].fontSize).toBe(size);
    }
  });

  it("reads a numeric anchor as the nearest side", () => {
    const two = String.raw`\node[draw] (a) at (0,0) {A};\node[draw] (b) at (4,0) {B};`;
    expect(parseTikz(`${two}\\draw[->] (a.0) -- (b.180);`)?.edges[0]).toMatchObject({
      sourceHandle: "r",
      targetHandle: "l",
    });
    expect(parseTikz(`${two}\\draw[->] (a.90) -- (b.270);`)?.edges[0]).toMatchObject({
      sourceHandle: "t",
      targetHandle: "b",
    });
  });

  it("treats draw=none and an unknown colour as no colour at all", () => {
    const model = parseTikz(String.raw`
      \node[draw=none, fill=blue] (a) at (0,0) {A};
      \node[draw, fill=notacolour] (b) at (3,0) {B};
    `);
    if (!model) throw new Error("no model");
    expect(node(model, "a").stroke).toBeUndefined();
    expect(node(model, "b").fill).toBeUndefined();
  });

  it("routes a path through a named coordinate without turning it into a shape", () => {
    const model = parseTikz(String.raw`
      \node[draw] (a) at (0,0) {A};
      \node[draw] (b) at (6,0) {B};
      \coordinate (bend) at (3,-3);
      \draw[->] (a) -- (bend) -- (b);
    `);
    if (!model) throw new Error("no model");
    expect(model.nodes.map((n) => n.id)).toEqual(["a", "b"]);
    expect(model.edges).toHaveLength(1);
    expect(model.edges[0]).toMatchObject({ source: "a", target: "b", routing: "orthogonal" });
  });

  it("names the environments it cannot draw", () => {
    const { unsupported } = importTikz(String.raw`\begin{tikzpicture}
      \begin{pgfonlayer}{background}
      \node[draw] (a) at (0,0) {A};
      \end{pgfonlayer}
    \end{tikzpicture}`);
    expect(unsupported).toContain("pgfonlayer");
  });

  it("reads a bend as a curve", () => {
    const model = parseTikz(
      String.raw`\node[draw] (a) at (0,0) {A};\node[draw] (b) at (4,0) {B};\draw[->, bend left] (a) to (b);`,
    );
    expect(model?.edges[0].routing).toBe("curved");
  });

  it("stays linear on long numeric option values", () => {
    const long = "9".repeat(20000);
    const started = Date.now();
    parseTikz(`\\node[draw, minimum width=${long}!, font=\\fontsize{${long}!}{12}] (a) at (0,0) {A};`);
    parseTikz(`\\node[draw] (a) at (${long}!:${long}!) {A};`);
    expect(Date.now() - started).toBeLessThan(1000);
  });
});

describe("option and shape details the emitter depends on", () => {
  it("paints stroke and text from a bare colour name", () => {
    const model = parseTikz(String.raw`\node[draw, red] (a) at (0,0) {A};`);
    expect(model?.nodes[0]).toMatchObject({ stroke: "#ff0000", textColor: "#ff0000" });
  });

  it("defaults a plain draw to black", () => {
    expect(parseTikz(String.raw`\node[draw] (a) at (0,0) {A};`)?.nodes[0].stroke).toBe("#000000");
  });

  it("lets a later option override an earlier one", () => {
    expect(parseTikz(String.raw`\node[draw, dashed, solid] (a) at (0,0) {A};`)?.nodes[0].strokeStyle).toBe("solid");
    expect(parseTikz(String.raw`\node[draw, solid, dashed] (a) at (0,0) {A};`)?.nodes[0].strokeStyle).toBe("dashed");
  });

  it("replaces a style on redefinition and appends only on request", () => {
    const replaced = parseTikz(String.raw`\begin{tikzpicture}[box/.style={draw, fill=red}, box/.style={draw, fill=blue}]
      \node[box] (a) at (0,0) {A};
    \end{tikzpicture}`);
    expect(replaced?.nodes[0].fill).toBe("#0000ff");
    const appended = parseTikz(String.raw`\begin{tikzpicture}[box/.style={draw, fill=red}, box/.append style={dashed}]
      \node[box] (a) at (0,0) {A};
    \end{tikzpicture}`);
    expect(appended?.nodes[0]).toMatchObject({ fill: "#ff0000", strokeStyle: "dashed" });
  });

  it("reads the shape key form", () => {
    expect(parseTikz(String.raw`\node[draw, shape=diamond] (a) at (0,0) {A};`)?.nodes[0].shape).toBe("diamond");
  });

  it("keeps a circle round", () => {
    const model = parseTikz(String.raw`\node[draw, circle] (a) at (0,0) {A wide label};`);
    expect(model?.nodes[0].w).toBe(model?.nodes[0].h);
  });

  it("reads a font size that carries a unit", () => {
    expect(
      parseTikz(String.raw`\node[draw, font=\fontsize{16pt}{19pt}\selectfont] (a) at (0,0) {A};`)?.nodes[0]
        .fontSize,
    ).toBe(16);
  });

  it("accepts an explicitly signed coordinate", () => {
    const model = parseTikz(String.raw`\node[draw] (a) at (+2,+1) {A};\node[draw] (b) at (0,0) {B};`);
    if (!model) throw new Error("no model");
    expect(node(model, "a").x).toBeGreaterThan(node(model, "b").x);
  });

  it("positions a node at another node", () => {
    const model = parseTikz(String.raw`
      \node[draw, minimum width=2cm, minimum height=1cm] (a) at (0,0) {A};
      \node[draw] (b) at (a.east) {B};
    `);
    if (!model) throw new Error("no model");
    const a = node(model, "a");
    expect(node(model, "b").x + node(model, "b").w / 2).toBe(a.x + a.w);
  });

  it("keeps a node name that contains spaces", () => {
    const model = parseTikz(String.raw`
      \node[draw] (first step) at (0,0) {A};
      \node[draw] (second step) at (4,0) {B};
      \draw[->] (first step) -- (second step);
    `);
    expect(model?.edges).toHaveLength(1);
    expect(model?.edges[0]).toMatchObject({ source: "first step", target: "second step" });
  });

  it("keeps explicit sizes exactly when the source sets no padding", () => {
    const source = String.raw`\node (a) at (0,0) [draw, inner sep=0pt, outer sep=0pt, minimum width=1cm, minimum height=0.5cm] {A very long label indeed};`;
    const once = parseTikz(source);
    expect(once?.nodes[0]).toMatchObject({ w: 40, h: 20 });
    const twice = parseTikz(modelToTikz(once as DiagramModel));
    expect(twice?.nodes[0]).toMatchObject({ w: 40, h: 20 });
  });

  it("leaves a picture that already sits in positive space where it is", () => {
    const model = parseTikz(String.raw`\node[draw, minimum width=1cm, minimum height=1cm] (a) at (5,-5) {A};`);
    expect(model?.nodes[0]).toMatchObject({ x: 180, y: 180 });
  });

  it("does not steal a standalone annotation that merely sits near a connector", () => {
    const model = parseTikz(String.raw`
      \node[draw, minimum width=1cm, minimum height=1cm] (a) at (0,0) {A};
      \node[draw, minimum width=1cm, minimum height=1cm] (b) at (0,-4) {B};
      \node at (1,-2) {Annotation};
      \draw[->] (a) -- (b);
    `);
    expect(model?.nodes.map((n) => n.label)).toContain("Annotation");
  });
});
