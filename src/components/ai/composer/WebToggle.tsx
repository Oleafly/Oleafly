import { Globe } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/** Turns web search and page reading on or off for the chat. */
export function WebToggle({
  on,
  onChange,
  disabled = false,
}: Readonly<{ on: boolean; onChange: (next: boolean) => void; disabled?: boolean }>) {
  const { t } = useTranslation(["common", "ai"]);
  return (
    <Tooltip label={on ? t(($) => $.ai.web.on) : t(($) => $.ai.web.off)}>
      <button
        type="button"
        aria-label={t(($) => $.ai.web.ariaLabel)}
        aria-pressed={on}
        data-state={on ? "on" : "off"}
        data-testid="ai-web-toggle"
        disabled={disabled}
        onClick={() => onChange(!on)}
        className={cn(
          "ai-composer-web flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
          on
            ? "bg-primary/10 text-primary hover:bg-primary/15 focus-visible:bg-primary/20"
            : "text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:bg-accent focus-visible:text-foreground",
        )}
      >
        <Globe className="size-4 shrink-0" />
        <span className="ai-composer-web-value">{t(($) => $.ai.web.label)}</span>
      </button>
    </Tooltip>
  );
}
