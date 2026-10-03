import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  acceptCompileOffer,
  downloadMissingTypst,
  switchToDefaultTypst,
  useCompileStore,
  type CompileOffer,
} from "@/store/compile";
import { useFilesStore } from "@/store/files";
import {
  typstInstallBusy,
  typstInstallLabel,
  useTypstToolchainStore,
} from "@/store/typst-toolchain";

export type CompileOfferPlacement = "preview" | "log" | "toolbar";

const TEST_IDS: Record<CompileOfferPlacement, string> = {
  preview: "preview-compile-offer",
  log: "log-compile-offer",
  toolbar: "toolbar-compile-offer",
};

function offerMatchesEngine(offer: CompileOffer, engineId: string): boolean {
  return offer.kind === "engine-gap" ? engineId === "latex" : engineId === "latexmk";
}

function missingTypstVersion(
  offer: CompileOffer | null,
  projectId: string | null,
  engineId: string,
  pinnedMissing: string | null,
): string | null {
  if (engineId !== "typst") return null;
  if (pinnedMissing) return pinnedMissing;
  return offer?.kind === "typst-version-missing" && offer.projectId === projectId ? offer.version : null;
}

function TypstMissingOffer({
  placement,
  projectId,
  version,
}: Readonly<{ placement: CompileOfferPlacement; projectId: string; version: string }>) {
  const { t } = useTranslation(["preview"]);
  const status = useTypstToolchainStore((s) => s.status);
  const install = useTypstToolchainStore((s) => s.install);
  const ensureLoaded = useTypstToolchainStore((s) => s.ensureLoaded);
  useEffect(() => {
    void ensureLoaded();
  }, [ensureLoaded]);
  const compact = placement !== "preview";
  const busy = typstInstallBusy(install, status);
  const downloadable =
    !status || status.versions.some((entry) => entry.version === version && entry.inCatalog);
  const fallback = status && status.defaultVersion !== version ? status.defaultVersion : null;
  const size = compact ? "xs" : "sm";
  return (
    <>
      {downloadable && (
        <Button
          size={size}
          variant={compact ? "ghostPrimary" : "outline"}
          data-testid={TEST_IDS[placement]}
          disabled={busy}
          onClick={() => void downloadMissingTypst(projectId, version)}
        >
          {install?.version === version
            ? typstInstallLabel(install)
            : t(($) => $.preview.actions.downloadTypst, { version })}
        </Button>
      )}
      {fallback && (
        <Button
          size={size}
          variant={compact ? "ghost" : "outline"}
          data-testid={`${TEST_IDS[placement]}-default`}
          disabled={busy}
          onClick={() => void switchToDefaultTypst(projectId)}
        >
          {t(($) => $.preview.actions.useTypst, { version: fallback })}
        </Button>
      )}
    </>
  );
}

export function CompileOfferButton({ placement }: Readonly<{ placement: CompileOfferPlacement }>) {
  const { t } = useTranslation(["preview"]);
  const offer = useCompileStore((s) => s.offer);
  const projectId = useFilesStore((s) => s.projectId);
  const engineId = useFilesStore((s) => s.engine.id);
  const pinnedMissing = useFilesStore((s) => s.engine.typst_missing ?? null);
  const typstVersion = missingTypstVersion(offer, projectId, engineId, pinnedMissing);
  if (projectId && typstVersion) {
    return <TypstMissingOffer placement={placement} projectId={projectId} version={typstVersion} />;
  }
  if (
    !offer ||
    offer.kind === "typst-version-missing" ||
    offer.projectId !== projectId ||
    !offerMatchesEngine(offer, engineId)
  ) {
    return null;
  }
  const label =
    offer.kind === "engine-gap"
      ? t(($) => $.preview.actions.chooseEngine)
      : t(($) => $.preview.actions.installPackages, {
          count: offer.packages.length,
          name: offer.packages[0],
        });
  const compact = placement !== "preview";
  return (
    <Button
      size={compact ? "xs" : "sm"}
      variant={compact ? "ghostPrimary" : "outline"}
      data-testid={TEST_IDS[placement]}
      onClick={() => acceptCompileOffer(offer)}
    >
      {label}
    </Button>
  );
}
