import { useTranslation } from "react-i18next";
import { Table2 } from "lucide-react";
import { ToolPageShell } from "@/components/tools/ToolPageShell";
import { TableGeneratorPanel } from "@/components/tools/TableGeneratorPanel";
import { toolName } from "@/lib/tool-catalog";

export function TableToolView() {
  const { t } = useTranslation(["common", "researchTools"]);
  return (
    <ToolPageShell
      page="table"
      title={toolName("table")}
      subtitle={t(($) => $.researchTools.table.subtitle)}
      icon={Table2}
      testId="table-tool-view"
    >
      <TableGeneratorPanel />
    </ToolPageShell>
  );
}
