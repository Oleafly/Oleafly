import { useTranslation } from "react-i18next";
import { LibraryBig } from "lucide-react";
import { LiteratureSearchPanel } from "@/components/tools/LiteratureSearchPanel";
import { ToolPageShell } from "@/components/tools/ToolPageShell";
import { toolName } from "@/lib/tool-catalog";

export function LiteratureSearchToolView() {
  const { t } = useTranslation(["common", "researchTools"]);
  return (
    <ToolPageShell
      page="literature-search"
      title={toolName("literature-search")}
      subtitle={t(($) => $.researchTools.literature.subtitle)}
      icon={LibraryBig}
      testId="literature-search-tool-view"
    >
      <LiteratureSearchPanel />
    </ToolPageShell>
  );
}
