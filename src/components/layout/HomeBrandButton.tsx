import { useTranslation } from "react-i18next";
import { Home } from "lucide-react";
import { LeafLogo } from "@/components/layout/LeafLogo";
import { Tooltip } from "@/components/ui/tooltip";

export function HomeBrandButton({
  onClick,
  className,
}: Readonly<{
  onClick: () => void;
  className?: string;
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
        onClick={onClick}
        aria-label={t(($) => $.shell.home.ariaLabel)}
        title={t(($) => $.shell.home.title)}
        className="group grid place-items-center rounded px-1.5 py-1 text-sm font-semibold tracking-tight hover:bg-accent"
      >
        <span className="col-start-1 row-start-1 flex items-center gap-1.5 group-hover:invisible">
          <LeafLogo className="size-5" />
          {"Oleafly"}
        </span>
        <span className="invisible col-start-1 row-start-1 flex items-center gap-1.5 group-hover:visible">
          <Home className="size-4" />
          {t(($) => $.shell.home.label)}
        </span>
      </button>
    </Tooltip>
  );
}
