import { useTranslation } from "react-i18next";
import { LayoutGrid, List, Table2 } from "lucide-react";
import { Tooltip } from "@/components/ui/tooltip";
import type { HomeProjectLayout } from "@/store/settings";
import { cn } from "@/lib/utils";

export function LayoutToggle<T extends HomeProjectLayout | "table" = HomeProjectLayout>({
  value,
  onChange,
  groupLabel,
  tableLabel,
  size = "default",
  className,
}: Readonly<{
  value: T;
  onChange: (layout: T) => void;
  groupLabel?: string;
  tableLabel?: string;
  size?: "default" | "sm";
  className?: string;
}>) {
  const { t } = useTranslation(["library"]);
  const modes = [
    { mode: "list" as T, label: t(($) => $.library.home.listView), icon: List },
    { mode: "grid" as T, label: t(($) => $.library.home.gridView), icon: LayoutGrid },
    ...(tableLabel ? [{ mode: "table" as T, label: tableLabel, icon: Table2 }] : []),
  ];
  return (
    <fieldset
      aria-label={groupLabel ?? t(($) => $.library.home.layoutGroup)}
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
              "flex items-center justify-center text-muted-foreground transition-colors focus-visible:bg-accent/60 focus-visible:text-foreground",
              size === "sm" ? "h-6 w-[1.875rem] rounded-[0.4375rem]" : "size-8 rounded-lg",
              value === mode ? "bg-accent text-foreground" : "hover:text-foreground",
            )}
          >
            <Icon aria-hidden className={size === "sm" ? "size-3.5" : "size-4"} />
          </button>
        </Tooltip>
      ))}
    </fieldset>
  );
}
