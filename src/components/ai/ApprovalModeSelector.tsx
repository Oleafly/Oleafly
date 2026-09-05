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
import type { ApprovalMode } from "@oleafly/ai-tools";
import { Popover } from "@/components/ui/popover";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const MODE_OPTIONS: Array<{
  mode: ApprovalMode;
  label: string;
  description: string;
  icon: LucideIcon;
}> = [
  {
    mode: "ask-for-approval",
    label: "Ask for approval",
    description: "Ask before file edits, internet access, and commands.",
    icon: ShieldAlert,
  },
  {
    mode: "approve-for-me",
    label: "Approve for me",
    description: "Ask only before actions classified as risky.",
    icon: ShieldCheck,
  },
  {
    mode: "full-access",
    label: "Full access",
    description: "Run tool actions without asking for approval.",
    icon: Shield,
  },
  {
    mode: "custom",
    label: "Custom (approvals.toml)",
    description: "Use the rules in approvals.toml. Edit them under Settings, AI Assistant.",
    icon: SlidersHorizontal,
  },
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
  const active = MODE_OPTIONS.find((option) => option.mode === mode) ?? MODE_OPTIONS[1];
  const ActiveIcon = active.icon;

  return (
    <Tooltip label={active.label} className="ai-composer-approval ml-1.5 min-w-0">
      <Popover
        align="left"
        ariaLabel={`Approval mode. ${active.label}`}
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
            <span className="ai-composer-approval-value truncate">{active.label}</span>
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
                aria-label={option.label}
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
                  <span className="block text-xs font-medium text-foreground">{option.label}</span>
                  <span
                    id={`approval-mode-description-${option.mode}`}
                    className="block text-[11px] leading-snug text-muted-foreground"
                  >
                    {option.description}
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
            aria-label="Edit project rules"
            disabled={disabled}
            onClick={() => {
              if (!disabled) onOpenProjectRules();
            }}
            className="mt-1 flex w-full items-center gap-2 border-t px-2.5 pb-1 pt-2.5 text-left text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <Settings2 className="size-3.5 shrink-0" />
            Edit project rules
          </button>
        )}
      </Popover>
    </Tooltip>
  );
}
