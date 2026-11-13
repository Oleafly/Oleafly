import { afterEach, describe, expect, it, vi } from "vitest";
import { i18n } from "@/i18n";
import enNotes from "@/i18n/locales/en/notes.json" with { type: "json" };
import { NEW_BLOCKS, newChartSource } from "./block-templates";
import { checkChart } from "./chart-block";
import { htmlTemplate } from "./html-block";
import "./tests/setup";

afterEach(() => {
  vi.restoreAllMocks();
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
      categories: ["A", "B", "C"],
      series: [{ name: enNotes.blocks.newChart.series, values: [3, 5, 2] }],
    });
    expect(source).toContain('\n  "title"');
    expect(checkChart(source).ok).toBe(true);
  });

  it("writes the HTML block's sample text in the interface language", () => {
    const template = htmlTemplate();
    expect(template).toContain(`<h3>${enNotes.blocks.newHtml.title}</h3>`);
    expect(template).toContain(`<label>${enNotes.blocks.newHtml.dose} <input`);
    expect(template).toContain(`<p>${enNotes.blocks.newHtml.response} <strong`);
  });

  it("escapes translated text so it stays text in the HTML block", () => {
    vi.spyOn(i18n, "t").mockReturnValue("Dosis <i> & Wirkung");
    const template = htmlTemplate();
    expect(template.match(/Dosis &lt;i&gt; &amp; Wirkung/gu)).toHaveLength(3);
    expect(template).not.toContain("<i>");
  });
});
