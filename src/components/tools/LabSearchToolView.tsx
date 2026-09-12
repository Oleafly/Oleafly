import { useTranslation } from "react-i18next";
import { School } from "lucide-react";
import { ToolPageShell } from "@/components/tools/ToolPageShell";
import { LabSearchPanel } from "@/components/tools/LabSearchPanel";
import { toolName } from "@/lib/tool-catalog";

export function LabSearchToolView() {
  const { t } = useTranslation(["common", "researchTools"]);
  return (
    <ToolPageShell
      page="lab-search"
      title={toolName("lab-search")}
      subtitle={t(($) => $.researchTools.labSearch.subtitle)}
      icon={School}
      testId="lab-search-tool-view"
    >
      <LabSearchPanel />
    </ToolPageShell>
  );
}
