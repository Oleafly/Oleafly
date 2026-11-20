import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { WorkspaceBannerButton, type WorkspaceBannerTone } from "@/components/ui/workspace-banner";

export function DismissButton({
  tone,
  label,
  onDismiss,
}: Readonly<{ tone: WorkspaceBannerTone; label?: string; onDismiss: () => void }>) {
  const { t } = useTranslation(["collab"]);
  return (
    <WorkspaceBannerButton tone={tone} aria-label={label ?? t(($) => $.collab.files.dismiss)} onClick={onDismiss}>
      <X aria-hidden className="size-3.5" />
    </WorkspaceBannerButton>
  );
}
