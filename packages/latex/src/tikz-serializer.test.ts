import { describe, expect, it } from "vitest";
import { modelToTikz, serializeDiagram, parseEmbeddedModel } from "./tikz-serializer";
import type { DiagramModel } from "./model";

const model: DiagramModel = {
  version: 1,
  nodes: [
    { id: "a", shape: "rectangle", x: 0, y: 0, w: 80, h: 40, label: "Input", fill: "#e0e7ff", stroke: "#1e3a8a" },
    { id: "b", shape: "circle", x: 0, y: 120, w: 60, h: 60, label: "$x_i$" },
  ],
  edges: [
    { id: "e1", source: "a", target: "b", routing: "straight", arrow: "forward", style: "solid", label: "flow" },
  ],
};

describe("modelToTikz", () => {
  it("wraps the nodes in a tikzpicture (\\node is undefined outside one)", () => {
    const t = modelToTikz(model);
    expect(t).toContain("\\begin{tikzpicture}");
    expect(t).toContain("\\end{tikzpicture}");
  });

  it("emits a node per shape with position and label", () => {
    const t = modelToTikz(model);
    expect(t).toContain("\\node (a)");
    expect(t).toContain("{Input}");
    expect(t).toContain("\\node (b)");
    expect(t).toContain("{$x_i$}");
    expect(t).toContain("circle");
  });

  it("defines custom colors and references them", () => {
    const t = modelToTikz(model);
    expect(t).toMatch(/\\definecolor\{c[0-9A-F]{6}\}\{HTML\}\{[0-9A-F]{6}\}/);
    expect(t).toContain("fill=cE0E7FF");
    expect(t).toContain("draw=c1E3A8A");
  });

  it("emits an arrowed edge with a label", () => {
    const t = modelToTikz(model);
    expect(t).toContain("\\draw[->");
    expect(t).toContain("(a)");
    expect(t).toContain("(b)");
    expect(t).toContain("flow");
  });

  it("preserves canvas edge handles, dotted lines, and curved direction", () => {
    const handledModel: DiagramModel = {
      version: 1,
      nodes: model.nodes,
      edges: [
        {
          id: "e-handles",
          source: "a",
          target: "b",
          sourceHandle: "b",
          targetHandle: "r",
          routing: "curved",
          arrow: "both",
          style: "dotted",
        },
      ],
    };
    const tikz = modelToTikz(handledModel);
    expect(tikz).toContain(
      "\\draw[<->, dash pattern=on 0.038cm off 0.1cm, line cap=round, line width=0.025cm] (a.south) to[out=-90, in=0] (b.east);",
    );
  });

  it("matches the canvas default bottom-to-top handles", () => {
    const tikz = modelToTikz(model);
    expect(tikz).toContain("(a.south) --");
    expect(tikz).toContain("(b.north)");
  });

  it("serializes the full canvas orthogonal route", () => {
    const tikz = modelToTikz({
      ...model,
      edges: [
        {
          id: "orthogonal",
          source: "a",
          target: "b",
          routing: "orthogonal",
          arrow: "forward",
          style: "dashed",
        },
      ],
    });
    expect(tikz).toContain(
      "(1,-1) -- (1,-1.5) -- (1,-2) -- (0.75,-2) -- (0.75,-2.5) -- (0.75,-3)",
    );
    expect(tikz).toContain("rounded corners=0.125cm");
    expect(tikz).toContain("dash pattern=on 0.15cm off 0.1cm");
  });

  it("routes same-side and perpendicular handles without changing attachment sides", () => {
    const sameSide = modelToTikz({
      ...model,
      edges: [
        {
          id: "same",
          source: "a",
          target: "b",
          sourceHandle: "r",
          targetHandle: "r",
          routing: "orthogonal",
          arrow: "both",
          style: "solid",
        },
      ],
    });
    expect(sameSide).toContain(
      "(2,-0.5) -- (2.5,-0.5) -- (2.5,-3.75) -- (2,-3.75) -- (1.5,-3.75)",
    );

    const perpendicular = modelToTikz({
      ...model,
      edges: [
        {
          id: "perpendicular",
          source: "a",
          target: "b",
          sourceHandle: "b",
          targetHandle: "l",
          routing: "orthogonal",
          arrow: "none",
          style: "dotted",
        },
      ],
    });
    expect(perpendicular).toContain("(1,-1)");
    expect(perpendicular).toContain("(0,-3.75)");
  });

  it("draws edges on the background layer so they sit behind the shapes", () => {
    const t = modelToTikz(model);
    expect(t).toContain("\\begin{scope}[on background layer]");
    // The edge must come after its nodes are declared, inside the scope.
    expect(t.indexOf("\\node (a)")).toBeLessThan(t.indexOf("on background layer"));
    expect(t.indexOf("on background layer")).toBeLessThan(t.indexOf("\\draw[->"));
  });

  it("omits the background scope when there are no edges", () => {
    const t = modelToTikz({ version: 1, nodes: [model.nodes[0]], edges: [] });
    expect(t).not.toContain("on background layer");
  });

  it("flips y: screen-down becomes tikz-up", () => {
    const t = modelToTikz(model);
    expect(t).toMatch(/\(b\) at \([\d.]+,\s*-[\d.]+\)/);
  });

  it("maps a diamond to the TikZ diamond shape", () => {
    const t = modelToTikz({
      version: 1,
      nodes: [{ id: "d", shape: "diamond", x: 0, y: 0, w: 90, h: 90, label: "a > b?" }],
      edges: [],
    });
    expect(t).toContain("[diamond,");
  });

  it("serializes each selectable font family", () => {
    const fontModel: DiagramModel = {
      version: 1,
      nodes: [
        { ...model.nodes[0], id: "serif", fontFamily: "serif" },
        { ...model.nodes[0], id: "sans", fontFamily: "sans" },
        { ...model.nodes[0], id: "mono", fontFamily: "mono" },
      ],
      edges: [],
    };
    const tikz = modelToTikz(fontModel);
    expect(tikz).toContain("font=\\rmfamily");
    expect(tikz).toContain("font=\\sffamily");
    expect(tikz).toContain("font=\\ttfamily");
  });

  it("maps a parallelogram to a TikZ trapezium (flowchart I/O)", () => {
    const t = modelToTikz({
      version: 1,
      nodes: [{ id: "p", shape: "parallelogram", x: 0, y: 0, w: 140, h: 60, label: "Read a" }],
      edges: [],
    });
    expect(t).toContain("trapezium");
    expect(t).toContain("trapezium left angle=62.82");
    expect(t).toContain("trapezium right angle=117.17");
  });
});

describe("round-trip", () => {
  it("embeds and parses the model back to an equal object", () => {
    const tikz = serializeDiagram(model);
    expect(tikz).toContain("% openleaf-diagram-v1:");
    const back = parseEmbeddedModel(tikz);
    expect(back).toEqual(model);
  });

  it("returns null when there is no embedded model", () => {
    expect(parseEmbeddedModel("\\node (a) {x};")).toBeNull();
  });
});
