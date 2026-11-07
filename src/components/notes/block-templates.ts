import { i18n } from "@/i18n";

export const NEW_BLOCKS = {
  latex: { info: "{=latex}", source: String.raw`\begin{equation}
  E = mc^2
\end{equation}` },
  mermaid: { info: "mermaid", source: "flowchart LR\n  A --> B" },
  typst: { info: "{=typst}", source: "$ E = m c^2 $" },
} as const;

export function newChartSource(): string {
  return JSON.stringify(
    {
      title: i18n.t(($) => $.notes.blocks.newChart.title),
      description: i18n.t(($) => $.notes.blocks.newChart.description),
      categories: ["A", "B", "C"],
      series: [{ name: i18n.t(($) => $.notes.blocks.newChart.series), values: [3, 5, 2] }],
    },
    null,
    2,
  );
}
