import { describe, expect, it } from "vitest";
import { mermaidToTikz } from "./mermaid-to-tikz";

describe("mermaidToTikz", () => {
  it("converts labelled flowchart edges and common shapes", () => {
    const tikz = mermaidToTikz(`flowchart TD
      start([Start]) --> check{Ready?}
      check -->|Yes| done((Done))
      check -.->|No| start`);
    expect(tikz).toContain("rounded rectangle");
    expect(tikz).toContain("diamond, aspect=2");
    expect(tikz).toContain("node[midway");
    expect(tikz).toContain("dashed");
    expect(tikz).toContain("\\end{tikzpicture}");
  });

  it("escapes labels once", () => {
    const tikz = mermaidToTikz("flowchart LR\na[R&D 50%] --> b[result_1]");
    expect(tikz).toContain("R\\&D 50\\%");
    expect(tikz).toContain("result\\_1");
  });

  it("rejects non-flowchart Mermaid instead of returning broken TikZ", () => {
    expect(() => mermaidToTikz("sequenceDiagram\nA->>B: Hello")).toThrow(
      "Start the diagram",
    );
  });

  it("defers syntax it cannot preserve instead of returning a partial diagram", () => {
    expect(() => mermaidToTikz("flowchart TD\nsubgraph Group\nA --> B\nend")).toThrow(
      "rendered output",
    );
    expect(() => mermaidToTikz("flowchart LR\nA --> B --> C")).toThrow(
      "Chained Mermaid edges",
    );
    expect(() => mermaidToTikz("flowchart LR\nA[/Input/] --> B")).toThrow(
      "could not be read",
    );
  });
});
