import { beforeAll, describe, expect, it } from "vitest";
import { loadNamespace } from "@/i18n";
import enNotes from "@/i18n/locales/en/notes.json" with { type: "json" };
import { NEW_BLOCKS, newChartSource } from "./block-templates";
import { parseChart } from "./chart-block";

beforeAll(async () => {
  await loadNamespace("notes");
});

describe("block templates", () => {
  it("marks LaTeX and Typst blocks as raw fences and Mermaid by name", () => {
    expect(NEW_BLOCKS.latex.info).toBe("{=latex}");
    expect(NEW_BLOCKS.mermaid.info).toBe("mermaid");
    expect(NEW_BLOCKS.typst.info).toBe("{=typst}");
  });

  it("starts each new block with working source", () => {
    expect(NEW_BLOCKS.latex.source).toBe("\\begin{equation}\n  E = mc^2\n\\end{equation}");
    expect(NEW_BLOCKS.mermaid.source).toBe("flowchart LR\n  A --> B");
    expect(NEW_BLOCKS.typst.source).toBe("$ E = m c^2 $");
  });

  it("writes a new chart with translated text that parses as chart data", () => {
    const source = newChartSource();
    expect(JSON.parse(source)).toEqual({
      title: enNotes.blocks.newChart.title,
      description: enNotes.blocks.newChart.description,
      categories: ["A", "B", "C"],
      series: [{ name: enNotes.blocks.newChart.series, values: [3, 5, 2] }],
    });
    expect(source).toContain('\n  "title"');
    expect(parseChart(source)).not.toBeNull();
  });
});
