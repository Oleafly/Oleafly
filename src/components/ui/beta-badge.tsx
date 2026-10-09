import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

export function BetaBadge({ className }: Readonly<{ className?: string }>) {
  const { t } = useTranslation(["common"]);
  return (
    <span
      data-testid="beta-badge"
      className={cn(
        "shrink-0 rounded-full border border-primary/30 bg-primary/10 px-1.5 text-[0.5625rem] font-semibold uppercase leading-[0.9375rem] tracking-wide text-primary",
        className,
      )}
    >
      {t(($) => $.common.state.beta)}
    </span>
  );
}
