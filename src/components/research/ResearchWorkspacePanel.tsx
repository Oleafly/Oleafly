import { FlaskConical } from "lucide-react";
import { useTranslation } from "react-i18next";
import { SidebarPanelHeader } from "@/components/layout/SidebarSection";
import { ResearchRootsPanel } from "@/components/research/workspace/ResearchRootsPanel";
import { useFilesStore } from "@/store/files";

export function ResearchWorkspacePanel() {
  const { t } = useTranslation(["researchTools"]);
  const projectId = useFilesStore((state) => state.projectId);
  return projectId ? (
    <div className="flex h-full min-h-0 flex-col" data-tour="research-workspace" data-testid="research-workspace-panel">
      <SidebarPanelHeader icon={FlaskConical} title={t(($) => $.researchTools.workspace.title)} />
      <ResearchRootsPanel projectId={projectId} />
    </div>
  ) : null;
}
