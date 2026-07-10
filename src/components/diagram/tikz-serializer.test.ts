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

  it("flips y: screen-down becomes tikz-up", () => {
    const t = modelToTikz(model);
    expect(t).toMatch(/\(b\) at \([\d.]+,\s*-[\d.]+\)/);
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
