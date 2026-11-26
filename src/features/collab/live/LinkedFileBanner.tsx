import { Link2, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Spinner } from "@/components/ui/spinner";
import { WorkspaceBanner, WorkspaceBannerAlert, WorkspaceBannerButton } from "@/components/ui/workspace-banner";
import { useCollabSettingsLocked, useOverleafLinked } from "@/lib/collab-live-bridge";
import type { OverleafLinkedFile } from "@/lib/overleaf-live";
import { basename } from "@/lib/path-utils";
import { useFilesStore } from "@/store/files";
import { refreshLinked, useLinkedRefresh } from "./linked-refresh";
import { PathMessage } from "./PathMessage";

function sourceOf(file: OverleafLinkedFile): string | null {
  const path = file.sourcePath?.replace(/^\/+/, "");
  return path || file.url;
}

export function LinkedFileBanner() {
  const { t } = useTranslation(["collab"]);
  const projectId = useFilesStore((state) => state.projectId);
  const path = useFilesStore((state) => state.activePath);
  const linked = useOverleafLinked(projectId, path);
  const writer = !useCollabSettingsLocked(projectId);
  const refreshing = useLinkedRefresh((state) => state.projectId === projectId && state.refreshing === path);
  const busy = useLinkedRefresh((state) => state.refreshing !== null);
  const failure = useLinkedRefresh((state) =>
    state.projectId === projectId && state.failure?.path === path ? state.failure.text : null,
  );
  if (!projectId || !path || !linked) return null;
  const file = basename(path);
  const source = sourceOf(linked);
  const message = source
    ? t(($) => $.collab.overleafLinked.banner, { file, source })
    : t(($) => $.collab.overleafLinked.bannerNoSource, { file });
  return (
    <WorkspaceBanner tone="primary" data-testid="overleaf-linked-banner">
      <Link2 aria-hidden className="size-3.5 shrink-0 text-primary" />
      <PathMessage paths={[path]}>{message}</PathMessage>
      {writer ? (
        <WorkspaceBannerButton
          tone="primary"
          disabled={busy}
          aria-busy={refreshing || undefined}
          onClick={() => void refreshLinked(projectId, path)}
        >
          {refreshing ? <Spinner size="xs" /> : <RefreshCw aria-hidden className="size-3.5" />}
          {refreshing ? t(($) => $.collab.overleafLinked.refreshing) : t(($) => $.collab.overleafLinked.refresh)}
        </WorkspaceBannerButton>
      ) : null}
      {failure ? <WorkspaceBannerAlert>{failure}</WorkspaceBannerAlert> : null}
    </WorkspaceBanner>
  );
}
