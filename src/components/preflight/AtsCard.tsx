import { memo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Check, Mail, MapPin, Minus, Phone, User, X } from "lucide-react";
import type { AtsParse } from "@oleafly/preflight";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
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
          let ariaLabel: string;
          let sectionTitle: string;
          let tone: BadgeVariant;
          let icon: ReactNode;
          if (s.present) {
            ariaLabel = tp("preflight:atsCard.detected", { section });
            sectionTitle = tp("preflight:atsCard.detectedTitle", { section });
            tone = "success";
            icon = <Check className="size-3" />;
          } else if (s.required) {
            ariaLabel = tp("preflight:atsCard.requiredMissing", { section });
            sectionTitle = tp("preflight:atsCard.requiredMissingTitle", { section });
            tone = "destructive";
            icon = <X className="size-3" />;
          } else {
            ariaLabel = tp("preflight:atsCard.optionalMissing", { section });
            sectionTitle = tp("preflight:atsCard.optionalMissingTitle", { section });
            tone = "muted";
            icon = <Minus className="size-3" />;
          }
          return (
            <Badge
              key={s.name}
              variant={tone}
              size="sm"
              role="img"
              data-testid={`ats-section-${s.name.toLocaleLowerCase("en-US")}`}
              data-present={s.present ? "true" : "false"}
              data-required={s.required ? "true" : "false"}
              aria-label={ariaLabel}
              title={sectionTitle}
              className="gap-1"
            >
              {icon}
              {section}
              {!s.required && <span className="sr-only">{t(($) => $.preflight.atsCard.optionalSuffix)}</span>}
            </Badge>
          );
        })}
      </div>
    </div>
  );
});
