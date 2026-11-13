import { useTranslation } from "react-i18next";
import { Home } from "lucide-react";
import { LeafLogo } from "@/components/layout/LeafLogo";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export function HomeBrandButton({
  onClick,
  className,
  compact = false,
  label,
  brand = "Oleafly",
}: Readonly<{
  onClick: () => void;
  className?: string;
  compact?: boolean;
  label?: string;
  brand?: string;
}>) {
  const { t } = useTranslation(["shell"]);
  return (
    <Tooltip
      label={label ?? t(($) => $.shell.home.tooltip)}
      side="bottom"
      className={className}
    >
      <button
        type="button"
        data-toolbar-part="home"
        onClick={onClick}
        aria-label={label ?? t(($) => $.shell.home.ariaLabel)}
        className="group grid place-items-center rounded px-1.5 py-1 text-sm font-semibold tracking-tight hover:bg-accent"
      >
        <span data-toolbar-part="brand" className="col-start-1 row-start-1 flex items-center gap-1.5 group-hover:invisible">
          <LeafLogo className="size-5" />
          <span data-brand-label className={cn(compact && "invisible absolute")}>{brand}</span>
        </span>
        <span className="invisible col-start-1 row-start-1 flex items-center gap-1.5 group-hover:visible">
          <Home className="size-5" />
          <span data-brand-label className={cn(compact && "invisible absolute")}>{t(($) => $.shell.home.label)}</span>
        </span>
      </button>
    </Tooltip>
  );
}
