import { useTranslation } from "react-i18next";
import { Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Tooltip } from "@/components/ui/tooltip";
import { useHidePersonalDetails } from "@/components/ui/private";
import { i18n } from "@/i18n";
import { togglePersonalDetails } from "@/store/personal-details";

/** What the toggle does next while the details are hidden: show them again. */
export function showPersonalDetailsLabel(): string {
  return i18n.t(($) => $.shell.personalDetails.show);
}

/** What the toggle does next while the details are shown: hide them. */
export function hidePersonalDetailsLabel(): string {
  return i18n.t(($) => $.shell.personalDetails.hide);
}

/**
 * The eye that turns screenshot mode on and off. It sits next to the theme
 * control wherever one is shown: the project toolbar, the home dock and the
 * tool pages. Windows has no View menu, so these are how the mode is reached.
 */
export function PersonalDetailsToggle({
  className,
  side = "bottom",
  testId = "personal-details-toggle",
}: Readonly<{
  className?: string;
  side?: "top" | "bottom" | "left" | "right";
  testId?: string;
}>) {
  useTranslation(["shell"]);
  const hidden = useHidePersonalDetails();
  const label = hidden ? showPersonalDetailsLabel() : hidePersonalDetailsLabel();
  const Icon = hidden ? EyeOff : Eye;
  return (
    <Tooltip label={label} side={side}>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        data-testid={testId}
        aria-label={label}
        onClick={togglePersonalDetails}
        className={className}
      >
        <Icon className="size-4" aria-hidden />
      </Button>
    </Tooltip>
  );
}

/** The same toggle as a row of the toolbar's overflow menu. */
export function PersonalDetailsMenuItem() {
  useTranslation(["shell"]);
  const hidden = useHidePersonalDetails();
  const Icon = hidden ? EyeOff : Eye;
  return (
    <DropdownMenuItem onSelect={togglePersonalDetails}>
      <Icon className="size-4" />
      {hidden ? showPersonalDetailsLabel() : hidePersonalDetailsLabel()}
    </DropdownMenuItem>
  );
}
