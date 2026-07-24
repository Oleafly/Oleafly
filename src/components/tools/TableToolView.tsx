import { Table2 } from "lucide-react";
import { ToolPageShell } from "@/components/tools/ToolPageShell";
import { TableGeneratorPanel } from "@/components/tools/TableGeneratorPanel";

export function TableToolView() {
  return (
    <ToolPageShell
      page="table"
      title="LaTeX Table Generator"
      subtitle="Visual row/column editor"
      icon={Table2}
      testId="table-tool-view"
    >
      <TableGeneratorPanel />
    </ToolPageShell>
  );
}
