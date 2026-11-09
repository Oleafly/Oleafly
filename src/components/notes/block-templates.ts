import { i18n } from "@/i18n";

export const NEW_BLOCKS = {
  latex: { info: "{=latex}", source: String.raw`\begin{equation}
  E = mc^2
\end{equation}` },
  mermaid: { info: "mermaid", source: "flowchart LR\n  A --> B" },
  typst: { info: "{=typst}", source: "$ E = m c^2 $" },
} as const;

export type BlockGroupId = "data" | "math" | "diagrams" | "code" | "science";

export const BLOCK_GROUPS: readonly { id: BlockGroupId; kinds: readonly string[] }[] = [
  { id: "data", kinds: ["csv", "chart", "plot"] },
  { id: "math", kinds: ["latex", "typst"] },
  { id: "diagrams", kinds: ["mermaid", "svg"] },
  { id: "code", kinds: ["html", "jsx"] },
  { id: "science", kinds: ["smiles", "molecule", "sequence"] },
];

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
