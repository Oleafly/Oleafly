import { ToolPageShell } from "@/components/tools/ToolPageShell";
import { EquationPreviewPanel } from "@/components/tools/EquationPreviewPanel";

export function EquationToolView() {
  return (
    <ToolPageShell page="equation" title="Equation Preview" testId="equation-tool-view">
      <EquationPreviewPanel />
    </ToolPageShell>
  );
}
