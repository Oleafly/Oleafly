import { ToolPageShell } from "@/components/tools/ToolPageShell";
import { LabSearchPanel } from "@/components/tools/LabSearchPanel";

export function LabSearchToolView() {
  return (
    <ToolPageShell page="lab-search" title="Lab Search" testId="lab-search-tool-view">
      <LabSearchPanel />
    </ToolPageShell>
  );
}
