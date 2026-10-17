import { Settings2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { WorkspaceBanner, WorkspaceBannerButton } from "@/components/ui/workspace-banner";
import { zoteroHintText } from "@/lib/zotero/hint";
import { openZoteroSettings } from "@/lib/zotero/open-settings";
import { cn } from "@/lib/utils";
import { useZoteroLibraryStore } from "@/store/zotero-library";

export function ZoteroHintBanner({
  className,
  onOpenSettings,
}: Readonly<{ className?: string; onOpenSettings?: () => void }>) {
  const { t } = useTranslation("references");
  const status = useZoteroLibraryStore((state) => state.status);
  const text = zoteroHintText(status);
  if (!text) return null;
  return (
    <WorkspaceBanner tone="warning" role="status" data-testid="zotero-hint" className={cn("border-b", className)}>
      <span className="min-w-0 flex-1">{text}</span>
      <WorkspaceBannerButton
        tone="warning"
        onClick={() => {
          onOpenSettings?.();
          openZoteroSettings();
        }}
      >
        <Settings2 aria-hidden className="size-3.5" />
        {t(($) => $.references.zotero.hint.action)}
      </WorkspaceBannerButton>
    </WorkspaceBanner>
  );
}
