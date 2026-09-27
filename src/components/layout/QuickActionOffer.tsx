import { useTranslation } from "react-i18next";
import { FolderOpen, Loader2, X } from "lucide-react";
import { addQuickAction, dismissQuickActionOffer } from "@/features/quick-action-offer";
import { useQuickActionOfferStore } from "@/store/quick-action-offer";

const SECONDARY =
  "inline-flex items-center rounded-md border border-input px-2.5 py-1.5 text-xs transition-colors hover:bg-accent focus-visible:bg-accent disabled:opacity-50";
const PRIMARY =
  "inline-flex items-center gap-1.5 rounded-md border border-transparent bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:bg-primary/80 disabled:opacity-50";

export function QuickActionOffer() {
  const { t } = useTranslation(["common", "shell"]);
  const phase = useQuickActionOfferStore((state) => state.phase);
  if (phase === "hidden") return null;
  const adding = phase === "adding";
  let message = t(($) => $.shell.quickActionOffer.body);
  if (phase === "added") message = t(($) => $.shell.quickActionOffer.added);
  if (phase === "addedInQuickActions") {
    message = t(($) => $.shell.quickActionOffer.addedInQuickActions);
  }
  if (phase === "failed") message = t(($) => $.shell.quickActionOffer.failed);
  return (
    <section
      aria-labelledby="quick-action-offer-title"
      data-testid="quick-action-offer"
      className="fixed bottom-4 right-4 z-[70] flex w-[min(360px,calc(100vw-2rem))] items-start gap-3 rounded-xl border bg-popover p-4 text-popover-foreground shadow-xl"
    >
      <FolderOpen aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />
      <div className="min-w-0 flex-1 space-y-3">
        <div className="space-y-1">
          <h2 id="quick-action-offer-title" className="text-sm font-medium">
            {t(($) => $.shell.quickActionOffer.title)}
          </h2>
          <output
            role={phase === "failed" ? "alert" : undefined}
            aria-live={phase === "failed" ? undefined : "polite"}
            className="block text-xs leading-relaxed text-muted-foreground"
          >
            {message}
          </output>
        </div>
        {phase === "offer" || adding ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              className={PRIMARY}
              disabled={adding}
              onClick={() => void addQuickAction()}
            >
              {adding ? <Loader2 aria-hidden className="size-3.5 animate-spin" /> : null}
              {t(($) => $.shell.quickActionOffer.add)}
            </button>
            <button
              type="button"
              className={SECONDARY}
              disabled={adding}
              onClick={dismissQuickActionOffer}
            >
              {t(($) => $.shell.quickActionOffer.notNow)}
            </button>
          </div>
        ) : null}
      </div>
      <button
        type="button"
        aria-label={t(($) => $.common.actions.close)}
        disabled={adding}
        onClick={dismissQuickActionOffer}
        className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:bg-accent focus-visible:text-foreground disabled:opacity-50"
      >
        <X aria-hidden className="size-3.5" />
      </button>
    </section>
  );
}
