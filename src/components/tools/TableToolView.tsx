import { ToolPageShell } from "@/components/tools/ToolPageShell";
import { TableGeneratorPanel } from "@/components/tools/TableGeneratorPanel";

export function TableToolView() {
  return (
    <ToolPageShell page="table" title="LaTeX Table Generator" testId="table-tool-view">
      <TableGeneratorPanel />
    </ToolPageShell>
  );
}
