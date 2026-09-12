import { memo } from "react";
import { useTranslation } from "react-i18next";
import { Check, Mail, MapPin, Minus, Phone, User, X } from "lucide-react";
import type { AtsParse } from "@oleafly/preflight";
import { cn } from "@/lib/utils";
import type { PreflightTranslate } from "./message";

export const AtsCard = memo(function AtsCard({ parse }: { parse: AtsParse }) {
  const { t } = useTranslation(["common", "preflight"]);
  const tp = t as unknown as PreflightTranslate;
  const field = (Icon: typeof User, value: string | null) => (
    <div className="flex items-center gap-2 text-xs">
      <Icon className="size-3.5 shrink-0 text-muted-foreground" />
      {value ? (
        <span className="truncate">{value}</span>
      ) : (
        <span className="text-red-500">{t(($) => $.preflight.atsCard.notFound)}</span>
      )}
    </div>
  );

  return (
    <div className="mx-3 mb-3 rounded-md border border-sidebar-border bg-black/[0.03] p-3 dark:bg-background">
      <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {t(($) => $.preflight.atsCard.title)}
      </p>
      <div className="flex flex-col gap-1.5">
        {field(User, parse.name)}
        {field(Mail, parse.email)}
        {field(Phone, parse.phone)}
        {field(
          MapPin,
          parse.links.length ? t(($) => $.preflight.atsCard.links, { count: parse.links.length }) : null,
        )}
      </div>
      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {parse.sections.map((s) => {
          const section = tp(`preflight:ats.sections.${s.id}`);
          return (
            <span
              key={s.name}
              role="img"
              data-testid={`ats-section-${s.name.toLocaleLowerCase("en-US")}`}
              data-present={s.present ? "true" : "false"}
              data-required={s.required ? "true" : "false"}
              aria-label={
                s.present
                  ? tp("preflight:atsCard.detected", { section })
                  : s.required
                    ? tp("preflight:atsCard.requiredMissing", { section })
                    : tp("preflight:atsCard.optionalMissing", { section })
              }
              title={
                s.present
                  ? tp("preflight:atsCard.detectedTitle", { section })
                  : s.required
                    ? tp("preflight:atsCard.requiredMissingTitle", { section })
                    : tp("preflight:atsCard.optionalMissingTitle", { section })
              }
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px]",
                s.present
                  ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                  : s.required
                    ? "bg-red-500/10 text-red-600 dark:text-red-400"
                    : "bg-muted text-muted-foreground",
              )}
            >
              {s.present ? (
                <Check className="size-3" />
              ) : s.required ? (
                <X className="size-3" />
              ) : (
                <Minus className="size-3" />
              )}
              {section}
              {!s.required && <span className="sr-only">{t(($) => $.preflight.atsCard.optionalSuffix)}</span>}
            </span>
          );
        })}
      </div>
    </div>
  );
});
