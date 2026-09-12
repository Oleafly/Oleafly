import {
  Check,
  ChevronDown,
  Settings2,
  Shield,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  type LucideIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ApprovalMode } from "@oleafly/ai-tools";
import { Popover } from "@/components/ui/popover";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type ApprovalModeKey = "askForApproval" | "approveForMe" | "fullAccess" | "custom";

const MODE_OPTIONS: Array<{
  mode: ApprovalMode;
  key: ApprovalModeKey;
  icon: LucideIcon;
}> = [
  { mode: "ask-for-approval", key: "askForApproval", icon: ShieldAlert },
  { mode: "approve-for-me", key: "approveForMe", icon: ShieldCheck },
  { mode: "full-access", key: "fullAccess", icon: Shield },
  { mode: "custom", key: "custom", icon: SlidersHorizontal },
];

export function ApprovalModeSelector({
  mode,
  onChange,
  onOpenProjectRules,
  disabled = false,
}: {
  mode: ApprovalMode;
  onChange: (mode: ApprovalMode) => void;
  onOpenProjectRules: () => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation(["common", "ai"]);
  const labels: Record<ApprovalModeKey, string> = {
    askForApproval: t(($) => $.ai.approval.modes.askForApproval.label),
    approveForMe: t(($) => $.ai.approval.modes.approveForMe.label),
    fullAccess: t(($) => $.ai.approval.modes.fullAccess.label),
    custom: t(($) => $.ai.approval.modes.custom.label),
  };
  const descriptions: Record<ApprovalModeKey, string> = {
    askForApproval: t(($) => $.ai.approval.modes.askForApproval.description),
    approveForMe: t(($) => $.ai.approval.modes.approveForMe.description),
    fullAccess: t(($) => $.ai.approval.modes.fullAccess.description),
    custom: t(($) => $.ai.approval.modes.custom.description),
  };
  const active = MODE_OPTIONS.find((option) => option.mode === mode) ?? MODE_OPTIONS[1];
  const ActiveIcon = active.icon;

  return (
    <Tooltip label={labels[active.key]} className="ai-composer-approval ml-1.5 min-w-0">
      <Popover
        align="left"
        ariaLabel={t(($) => $.ai.approval.selectorAriaLabel, { mode: labels[active.key] })}
        disabled={disabled}
        triggerClassName={cn(
          "ai-composer-approval-trigger h-7 min-w-0 max-w-48 gap-1.5 rounded-full border pl-2.5 pr-2 text-xs font-medium",
          mode === "ask-for-approval" &&
            "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/15 dark:text-emerald-300",
          mode === "approve-for-me" &&
            "border-amber-500/30 bg-amber-500/10 text-amber-700 hover:bg-amber-500/15 dark:text-amber-300",
          mode === "full-access" &&
            "border-red-500/35 bg-red-500/10 text-red-700 hover:bg-red-500/15 dark:text-red-300",
          mode === "custom" &&
            "border-sky-500/30 bg-sky-500/10 text-sky-700 hover:bg-sky-500/15 dark:text-sky-300",
        )}
        className="w-72 p-1.5"
        trigger={
          <>
            <ActiveIcon className="size-3.5 shrink-0" />
            <span className="ai-composer-approval-value truncate">{labels[active.key]}</span>
            <ChevronDown className="size-3.5 shrink-0" />
          </>
        }
      >
        <div className="space-y-0.5">
          {MODE_OPTIONS.map((option) => {
            const Icon = option.icon;
            return (
              <button
                key={option.mode}
                type="button"
                aria-label={labels[option.key]}
                aria-pressed={option.mode === mode}
                aria-describedby={`approval-mode-description-${option.mode}`}
                disabled={disabled}
                onClick={() => {
                  if (!disabled) onChange(option.mode);
                }}
                className="flex w-full items-start gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-accent"
              >
                <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-medium text-foreground">{labels[option.key]}</span>
                  <span
                    id={`approval-mode-description-${option.mode}`}
                    className="block text-[11px] leading-snug text-muted-foreground"
                  >
                    {descriptions[option.key]}
                  </span>
                </span>
                {option.mode === mode && (
                  <Check className="mt-0.5 size-3.5 shrink-0 text-emerald-500" />
                )}
              </button>
            );
          })}
        </div>
        {mode === "custom" && (
          <button
            type="button"
            aria-label={t(($) => $.ai.approval.editProjectRules)}
            disabled={disabled}
            onClick={() => {
              if (!disabled) onOpenProjectRules();
            }}
            className="mt-1 flex w-full items-center gap-2 border-t px-2.5 pb-1 pt-2.5 text-left text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <Settings2 className="size-3.5 shrink-0" />
            {t(($) => $.ai.approval.editProjectRules)}
          </button>
        )}
      </Popover>
    </Tooltip>
  );
}
