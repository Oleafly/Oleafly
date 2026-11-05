import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { useCollabProjectShared, useCollabSettingsLocked } from "@/lib/collab-live-bridge";
import { tinytexActionLabel } from "@/lib/tinytex-label";
import { installMissingTex, switchToTectonic } from "@/store/compile";
import { useEngineStore } from "@/store/engine";
import { useSettingsStore } from "@/store/settings";

function openTexSettings(): void {
  const settings = useSettingsStore.getState();
  settings.setSettingsInitialSection("engine");
  settings.setSettingsOpen(true);
}

export function TexMissingOffer({
  compact,
  testId,
  projectId,
  offerTectonic = true,
}: Readonly<{ compact: boolean; testId: string; projectId: string; offerTectonic?: boolean }>) {
  const { t } = useTranslation(["preview", "shell"]);
  const canInstallTinytex = useEngineStore(
    (s) => s.info?.kind !== "tinytex" && (!s.info?.tex_complete || !!s.info?.latexmk_blocker),
  );
  const installing = useEngineStore((s) => s.installing);
  const installPhase = useEngineStore((s) => s.installPhase);
  const progress = useEngineStore((s) => s.progress);
  const partialDownloadBytes = useEngineStore((s) => s.partialDownloadBytes);
  const ensureLoaded = useEngineStore((s) => s.ensureLoaded);
  const shared = useCollabProjectShared(projectId);
  const settingsLocked = useCollabSettingsLocked(projectId);
  useEffect(() => {
    void ensureLoaded();
  }, [ensureLoaded]);
  const size = compact ? "xs" : "sm";
  return (
    <>
      {canInstallTinytex && (
        <Button
          size={size}
          variant={compact ? "ghostPrimary" : "outline"}
          data-testid={testId}
          disabled={installing}
          onClick={() => void installMissingTex(projectId)}
        >
          {tinytexActionLabel({ installing, installPhase, progress, partialDownloadBytes })}
        </Button>
      )}
      {!compact && offerTectonic && !settingsLocked && (
        <Button
          size={size}
          variant="outline"
          data-testid={`${testId}-tectonic`}
          onClick={() => void switchToTectonic(projectId)}
        >
          {shared
            ? t(($) => $.preview.actions.useTectonicForEveryone)
            : t(($) => $.preview.actions.useTectonic)}
        </Button>
      )}
      <Button
        size={size}
        variant={compact ? "ghost" : "outline"}
        data-testid={`${testId}-settings`}
        onClick={openTexSettings}
      >
        {t(($) => $.preview.actions.engineSettings)}
      </Button>
    </>
  );
}
