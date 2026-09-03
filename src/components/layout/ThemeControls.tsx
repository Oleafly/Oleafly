import { useState } from "react";
import { Monitor, Moon, Sun, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip } from "@/components/ui/tooltip";
import { useTheme, type ThemePreference } from "@/lib/theme";
import { cn } from "@/lib/utils";

export const THEME_PREFERENCES: readonly ThemePreference[] = ["system", "light", "dark"];

const THEME_LABELS: Record<ThemePreference, string> = {
  system: "System",
  light: "Light",
  dark: "Dark",
};

const THEME_ICONS: Record<ThemePreference, LucideIcon> = {
  system: Monitor,
  light: Sun,
  dark: Moon,
};

type Side = "top" | "bottom" | "left" | "right";

export function themePreferenceLabel(preference: ThemePreference): string {
  return THEME_LABELS[preference];
}

export function themeMenuLabel(preference: ThemePreference): string {
  return `Appearance: ${THEME_LABELS[preference]}`;
}

export function ThemeMenu({
  side = "bottom",
  align = "end",
  triggerClassName,
  testId = "theme-menu",
}: {
  side?: Side;
  align?: "start" | "center" | "end";
  triggerClassName?: string;
  testId?: string;
}) {
  const { preference, setPreference } = useTheme();
  const [open, setOpen] = useState(false);
  const label = themeMenuLabel(preference);
  const Icon = THEME_ICONS[preference];

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <Tooltip label={label} side={side}>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            data-testid={testId}
            aria-label={label}
            className={triggerClassName}
            onClick={() => setOpen((value) => !value)}
          >
            <Icon className="size-4" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
      </Tooltip>
      <DropdownMenuContent side={side} align={align} className="min-w-36">
        <DropdownMenuRadioGroup value={preference}>
          {THEME_PREFERENCES.map((value) => {
            const OptionIcon = THEME_ICONS[value];
            return (
              <DropdownMenuRadioItem
                key={value}
                value={value}
                data-testid={`theme-option-${value}`}
                className="gap-2"
                onClick={() => setPreference(value)}
              >
                <OptionIcon className="size-4" aria-hidden />
                {THEME_LABELS[value]}
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ThemeSegmentedControl({
  preference,
  onChange,
  variant = "cards",
  testIdPrefix,
  className,
}: {
  preference: ThemePreference;
  onChange: (preference: ThemePreference) => void;
  variant?: "cards" | "pill";
  testIdPrefix?: string;
  className?: string;
}) {
  const pill = variant === "pill";
  return (
    <div
      className={cn(
        "grid grid-cols-3",
        pill ? "gap-1 rounded-xl bg-muted/35 p-1" : "gap-2",
        className,
      )}
    >
      {THEME_PREFERENCES.map((value) => {
        const Icon = THEME_ICONS[value];
        const active = preference === value;
        return (
          <button
            type="button"
            key={value}
            data-testid={testIdPrefix ? `${testIdPrefix}-${value}` : undefined}
            aria-label={`Use ${value} theme`}
            aria-pressed={active}
            onClick={() => onChange(value)}
            className={cn(
              "flex h-9 items-center justify-center gap-2 text-xs font-medium transition-colors",
              pill
                ? cn(
                    "rounded-lg",
                    active
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )
                : cn(
                    "rounded-md border",
                    active
                      ? "border-primary bg-primary/5 text-foreground"
                      : "border-border text-muted-foreground hover:bg-accent hover:text-foreground",
                  ),
            )}
          >
            <Icon className="size-3.5" aria-hidden />
            {THEME_LABELS[value]}
          </button>
        );
      })}
    </div>
  );
}
