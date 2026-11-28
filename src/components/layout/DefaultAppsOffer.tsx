import { useTranslation } from "react-i18next";
import { FileText } from "lucide-react";
import { OfferCard, OfferCardAction } from "@/components/ui/offer-card";
import { Checkbox } from "@/components/ui/checkbox";
import { applyDefaultApps, dismissDefaultAppsOffer } from "@/features/default-apps-offer";
import { useDefaultAppsOfferStore } from "@/store/default-apps-offer";
import type { DefaultAppItemId } from "@/lib/tauri";
import { isMac } from "@/lib/utils";

export const DEFAULT_APP_COPY = {
  default_latex: "latex",
  default_typst: "typst",
  default_markdown: "markdown",
  default_quarto: "quarto",
} as const satisfies Record<DefaultAppItemId, string>;

export function DefaultAppsOffer() {
  const { t } = useTranslation(["shell"]);
  const phase = useDefaultAppsOfferStore((state) => state.phase);
  const offered = useDefaultAppsOfferStore((state) => state.offered);
  const chosen = useDefaultAppsOfferStore((state) => state.chosen);
  const toggle = useDefaultAppsOfferStore((state) => state.toggle);
  if (phase === "hidden") return null;
  const applying = phase === "applying";
  let message = t(($) => $.shell.defaultAppsOffer.body);
  if (phase === "done") {
    message = isMac ? t(($) => $.shell.defaultAppsOffer.doneMac) : t(($) => $.shell.defaultAppsOffer.done);
  }
  if (phase === "failed") message = t(($) => $.shell.defaultAppsOffer.failed);
  return (
    <OfferCard
      icon={FileText}
      titleId="default-apps-offer-title"
      testId="default-apps-offer"
      title={t(($) => $.shell.defaultAppsOffer.title)}
      message={message}
      failed={phase === "failed"}
      busy={applying}
      onClose={dismissDefaultAppsOffer}
    >
      {phase === "offer" || applying ? (
        <>
          <ul className="space-y-1.5">
            {offered.map((id) => (
              <li key={id} className="flex items-center gap-2 text-xs">
                <Checkbox
                  id={`default-apps-offer-${id}`}
                  data-testid={`default-apps-offer-${id}`}
                  checked={chosen.includes(id)}
                  disabled={applying}
                  onCheckedChange={(value) => toggle(id, value === true)}
                />
                <label htmlFor={`default-apps-offer-${id}`}>
                  {t(($) => $.shell.defaultAppsOffer.types[DEFAULT_APP_COPY[id]])}
                </label>
              </li>
            ))}
          </ul>
          <div className="flex items-center gap-2">
            <OfferCardAction
              tone="primary"
              busy={applying}
              disabled={applying || chosen.length === 0}
              onClick={() => void applyDefaultApps()}
            >
              {t(($) => $.shell.defaultAppsOffer.use)}
            </OfferCardAction>
            <OfferCardAction disabled={applying} onClick={dismissDefaultAppsOffer}>
              {t(($) => $.shell.defaultAppsOffer.keep)}
            </OfferCardAction>
          </div>
        </>
      ) : null}
    </OfferCard>
  );
}
