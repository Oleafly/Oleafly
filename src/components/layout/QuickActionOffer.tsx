import { useTranslation } from "react-i18next";
import { FolderOpen } from "lucide-react";
import { addQuickAction, dismissQuickActionOffer } from "@/features/quick-action-offer";
import { useQuickActionOfferStore } from "@/store/quick-action-offer";
import { useDefaultAppsOfferStore } from "@/store/default-apps-offer";
import { OfferCard, OfferCardAction } from "@/components/ui/offer-card";

export function QuickActionOffer() {
  const { t } = useTranslation(["shell"]);
  const phase = useQuickActionOfferStore((state) => state.phase);
  const defaultAppsAsking = useDefaultAppsOfferStore((state) => state.phase !== "hidden");
  if (phase === "hidden" || defaultAppsAsking) return null;
  const adding = phase === "adding";
  let message = t(($) => $.shell.quickActionOffer.body);
  if (phase === "added") message = t(($) => $.shell.quickActionOffer.added);
  if (phase === "addedInQuickActions") {
    message = t(($) => $.shell.quickActionOffer.addedInQuickActions);
  }
  if (phase === "failed") message = t(($) => $.shell.quickActionOffer.failed);
  return (
    <OfferCard
      icon={FolderOpen}
      titleId="quick-action-offer-title"
      testId="quick-action-offer"
      title={t(($) => $.shell.quickActionOffer.title)}
      message={message}
      failed={phase === "failed"}
      busy={adding}
      onClose={dismissQuickActionOffer}
    >
      {phase === "offer" || adding ? (
        <div className="flex items-center gap-2">
          <OfferCardAction tone="primary" busy={adding} disabled={adding} onClick={() => void addQuickAction()}>
            {t(($) => $.shell.quickActionOffer.add)}
          </OfferCardAction>
          <OfferCardAction disabled={adding} onClick={dismissQuickActionOffer}>
            {t(($) => $.shell.quickActionOffer.notNow)}
          </OfferCardAction>
        </div>
      ) : null}
    </OfferCard>
  );
}
