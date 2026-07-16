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

  it("maps a parallelogram to a TikZ trapezium (flowchart I/O)", () => {
    const t = modelToTikz({
      version: 1,
      nodes: [{ id: "p", shape: "parallelogram", x: 0, y: 0, w: 140, h: 60, label: "Read a" }],
      edges: [],
    });
    expect(t).toContain("trapezium");
    expect(t).toContain("trapezium left angle=70");
    expect(t).toContain("trapezium right angle=110");
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
