import { HardDrive } from "@/components/icons/pack";
import { useTranslation } from "react-i18next";
import { WorkspaceBanner } from "@/components/ui/workspace-banner";
import { useFilesStore } from "@/store/files";
import { useCollabLiveStore } from "./live-store";

export function ProjectFullBanner() {
  const { t } = useTranslation(["collab"]);
  const projectId = useFilesStore((state) => state.projectId);
  const full = useCollabLiveStore((state) => state.projectFull && state.projectId === projectId);
  // The status region stays mounted while the banner comes and goes, so
  // screen readers announce the banner when it appears.
  return (
    <div role="status" className="shrink-0">
      {full && projectId !== null ? (
        <WorkspaceBanner tone="warning" data-testid="collab-project-full">
          <HardDrive aria-hidden className="size-3.5 shrink-0" />
          <p className="min-w-0 flex-1 select-text">{t(($) => $.collab.files.projectFull)}</p>
        </WorkspaceBanner>
      ) : null}
    </div>
  );
}
