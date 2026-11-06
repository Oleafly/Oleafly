import { useTranslation } from "react-i18next";
import { List } from "lucide-react";
import { LayoutGrid } from "@/components/icons/pack";
import { Tooltip } from "@/components/ui/tooltip";
import type { HomeProjectLayout } from "@/store/settings";
import { cn } from "@/lib/utils";

export function LayoutToggle({
  value,
  onChange,
  className,
}: Readonly<{
  value: HomeProjectLayout;
  onChange: (layout: HomeProjectLayout) => void;
  className?: string;
}>) {
  const { t } = useTranslation(["library"]);
  const modes = [
    { mode: "list", label: t(($) => $.library.home.listView), icon: List },
    { mode: "grid", label: t(($) => $.library.home.gridView), icon: LayoutGrid },
  ] as const;
  return (
    <fieldset
      aria-label={t(($) => $.library.home.layoutGroup)}
      className={cn("flex items-center rounded-xl p-1", className)}
    >
      {modes.map(({ mode, label, icon: Icon }) => (
        <Tooltip key={mode} label={label} side="bottom">
          <button
            type="button"
            onClick={() => onChange(mode)}
            aria-label={label}
            aria-pressed={value === mode}
            className={cn(
              "flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors focus-visible:bg-accent/60 focus-visible:text-foreground",
              value === mode ? "bg-accent text-foreground" : "hover:text-foreground",
            )}
          >
            <Icon aria-hidden className="size-4" />
          </button>
        </Tooltip>
      ))}
    </fieldset>
  );
}
