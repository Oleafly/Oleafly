import { useTranslation } from "react-i18next";
import { Home } from "lucide-react";
import { LeafLogo } from "@/components/layout/LeafLogo";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export function HomeBrandButton({
  onClick,
  className,
  compact = false,
}: Readonly<{
  onClick: () => void;
  className?: string;
  compact?: boolean;
}>) {
  const { t } = useTranslation(["shell"]);
  return (
    <Tooltip
      label={t(($) => $.shell.home.tooltip)}
      side="bottom"
      className={className}
    >
      <button
        type="button"
        data-toolbar-part="home"
        onClick={onClick}
        aria-label={t(($) => $.shell.home.ariaLabel)}
        title={t(($) => $.shell.home.title)}
        className="group grid place-items-center rounded px-1.5 py-1 text-sm font-semibold tracking-tight hover:bg-accent"
      >
        <span data-toolbar-part="brand" className="col-start-1 row-start-1 flex items-center gap-1.5 group-hover:invisible">
          <LeafLogo className="size-5" />
          <span data-brand-label className={cn(compact && "invisible absolute")}>Oleafly</span>
        </span>
        <span className="invisible col-start-1 row-start-1 flex items-center gap-1.5 group-hover:visible">
          <Home className="size-5" />
          <span data-brand-label className={cn(compact && "invisible absolute")}>{t(($) => $.shell.home.label)}</span>
        </span>
      </button>
    </Tooltip>
  );
}
