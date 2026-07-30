import { School } from "lucide-react";
import { ToolPageShell } from "@/components/tools/ToolPageShell";
import { LabSearchPanel } from "@/components/tools/LabSearchPanel";

export function LabSearchToolView() {
  return (
    <ToolPageShell
      page="lab-search"
      title="Lab Search"
      subtitle="Find institutions and review OpenAlex records"
      icon={School}
      testId="lab-search-tool-view"
    >
      <LabSearchPanel />
    </ToolPageShell>
  );
}
