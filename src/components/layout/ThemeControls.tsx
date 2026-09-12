import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
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
import { i18n } from "@/i18n";

export const THEME_PREFERENCES: readonly ThemePreference[] = ["system", "light", "dark"];

const THEME_LABELS: Record<ThemePreference, () => string> = {
  system: () => i18n.t(($) => $.shell.theme.system),
  light: () => i18n.t(($) => $.shell.theme.light),
  dark: () => i18n.t(($) => $.shell.theme.dark),
};

const THEME_ICONS: Record<ThemePreference, LucideIcon> = {
  system: Monitor,
  light: Sun,
  dark: Moon,
};

type Side = "top" | "bottom" | "left" | "right";

function themeOptionClass(pill: boolean, active: boolean) {
  if (pill) {
    return cn(
      "rounded-lg",
      active
        ? "bg-background text-foreground shadow-sm"
        : "text-muted-foreground hover:text-foreground",
    );
  }
  return cn(
    "rounded-md border",
    active
      ? "border-primary bg-primary/5 text-foreground"
      : "border-border text-muted-foreground hover:bg-accent hover:text-foreground",
  );
}

export function themePreferenceLabel(preference: ThemePreference): string {
  return THEME_LABELS[preference]();
}

export function themeMenuLabel(preference: ThemePreference): string {
  return i18n.t(($) => $.shell.theme.menuLabel, { name: themePreferenceLabel(preference) });
}

export function ThemeMenu({
  side = "bottom",
  align = "end",
  triggerClassName,
  testId = "theme-menu",
}: Readonly<{
  side?: Side;
  align?: "start" | "center" | "end";
  triggerClassName?: string;
  testId?: string;
}>) {
  useTranslation(["shell"]);
  const { preference, theme, setPreference } = useTheme();
  const [open, setOpen] = useState(false);
  const pointerToggled = useRef(false);
  const label = themeMenuLabel(preference);
  const TriggerIcon = theme === "dark" ? Moon : Sun;

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <Tooltip label={label} side={side} suppressed={open}>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            data-testid={testId}
            aria-label={label}
            className={triggerClassName}
            onPointerDown={() => {
              pointerToggled.current = true;
            }}
            onClick={() => {
              if (pointerToggled.current) {
                pointerToggled.current = false;
                return;
              }
              setOpen((value) => !value);
            }}
          >
            <TriggerIcon className="size-4" aria-hidden />
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
                {themePreferenceLabel(value)}
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
}: Readonly<{
  preference: ThemePreference;
  onChange: (preference: ThemePreference) => void;
  variant?: "cards" | "pill";
  testIdPrefix?: string;
  className?: string;
}>) {
  const { t } = useTranslation(["shell"]);
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
            aria-label={
              value === "system"
                ? t(($) => $.shell.theme.useSystem)
                : value === "light"
                  ? t(($) => $.shell.theme.useLight)
                  : t(($) => $.shell.theme.useDark)
            }
            aria-pressed={active}
            onClick={() => onChange(value)}
            className={cn(
              "flex h-9 items-center justify-center gap-2 text-xs font-medium transition-colors",
              themeOptionClass(pill, active),
            )}
          >
            <Icon className="size-3.5" aria-hidden />
            {themePreferenceLabel(value)}
          </button>
        );
      })}
    </div>
  );
}
