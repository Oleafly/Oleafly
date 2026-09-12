import { useTranslation } from "react-i18next";
import { ShieldCheck } from "lucide-react";
import { ToolPageShell } from "@/components/tools/ToolPageShell";
import { BibtexValidatorPanel } from "@/components/tools/BibtexValidatorPanel";
import { toolName } from "@/lib/tool-catalog";

export function BibtexToolView() {
  const { t } = useTranslation(["common", "researchTools"]);
  return (
    <ToolPageShell
      page="bibtex"
      title={toolName("bibtex")}
      subtitle={t(($) => $.researchTools.bibtex.subtitle)}
      icon={ShieldCheck}
      testId="bibtex-tool-view"
    >
      <BibtexValidatorPanel />
    </ToolPageShell>
  );
}
