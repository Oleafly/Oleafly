import { HardDrive } from "lucide-react";
import { useTranslation } from "react-i18next";
import { WorkspaceBanner } from "@/components/ui/workspace-banner";
import { useFilesStore } from "@/store/files";
import { useCollabLiveStore } from "./live-store";

// The server refuses this project's changes because it reached its size
// limit. Nothing is lost, but nothing reaches the others until it's raised.
export function ProjectFullBanner() {
  const { t } = useTranslation(["collab"]);
  const projectId = useFilesStore((state) => state.projectId);
  const full = useCollabLiveStore((state) => state.projectFull && state.projectId === projectId);
  if (!full || projectId === null) return null;
  return (
    <WorkspaceBanner tone="warning" data-testid="collab-project-full">
      <HardDrive aria-hidden className="size-3.5 shrink-0" />
      <p role="status" className="min-w-0 flex-1 select-text">
        {t(($) => $.collab.files.projectFull)}
      </p>
    </WorkspaceBanner>
  );
}
