import { ArrowDownWideNarrow, Regex, Sparkles, TextQuote } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip } from "@/components/ui/tooltip";
import { SEARCH_MODES, type SearchMode } from "@/lib/search-modes";
import { cn } from "@/lib/utils";

const ICONS = { ranked: ArrowDownWideNarrow, exact: TextQuote, regex: Regex, fuzzy: Sparkles } as const;

export function SearchModeMenu({
  value,
  onChange,
  className,
}: Readonly<{ value: SearchMode; onChange: (mode: SearchMode) => void; className?: string }>) {
  const { t } = useTranslation(["common"]);
  const Icon = ICONS[value];
  const label = t(($) => $.common.searchModes.label, { mode: t(($) => $.common.searchModes[value].label) });
  return (
    <DropdownMenu>
      <Tooltip label={label} side="bottom">
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label={label}
            data-search-mode={value}
            className={cn("size-7 shrink-0 text-muted-foreground data-[state=open]:bg-accent", value !== "ranked" && "text-primary", className)}
          >
            <Icon aria-hidden className="size-4" />
          </Button>
        </DropdownMenuTrigger>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel className="text-xs text-muted-foreground">{t(($) => $.common.searchModes.heading)}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={value} onValueChange={(next) => onChange(next as SearchMode)}>
          {SEARCH_MODES.map((mode) => {
            const ModeIcon = ICONS[mode];
            return (
              <DropdownMenuRadioItem key={mode} value={mode} className="items-start">
                <ModeIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0">
                  <span className="block">{t(($) => $.common.searchModes[mode].label)}</span>
                  <span className="block text-xs text-muted-foreground">{t(($) => $.common.searchModes[mode].description)}</span>
                </span>
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
