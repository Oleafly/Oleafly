import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { acceptCompileOffer, useCompileStore, type CompileOffer } from "@/store/compile";
import { useFilesStore } from "@/store/files";

export type CompileOfferPlacement = "preview" | "log" | "toolbar";

const TEST_IDS: Record<CompileOfferPlacement, string> = {
  preview: "preview-compile-offer",
  log: "log-compile-offer",
  toolbar: "toolbar-compile-offer",
};

function offerMatchesEngine(offer: CompileOffer, engineId: string): boolean {
  return offer.kind === "engine-gap" ? engineId === "latex" : engineId === "latexmk";
}

export function CompileOfferButton({ placement }: Readonly<{ placement: CompileOfferPlacement }>) {
  const { t } = useTranslation(["preview"]);
  const offer = useCompileStore((s) => s.offer);
  const projectId = useFilesStore((s) => s.projectId);
  const engineId = useFilesStore((s) => s.engine.id);
  if (!offer || offer.projectId !== projectId || !offerMatchesEngine(offer, engineId)) return null;
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
