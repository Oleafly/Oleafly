import { Globe } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
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
      <Button
        type="button"
        variant={on ? "ghostPrimary" : "ghost"}
        size="sm"
        aria-label={t(($) => $.ai.web.ariaLabel)}
        aria-pressed={on}
        data-state={on ? "on" : "off"}
        data-testid="ai-web-toggle"
        disabled={disabled}
        onClick={() => onChange(!on)}
        className={cn(
          "ai-composer-web h-7 shrink-0 gap-1.5 px-2",
          on
            ? "bg-primary/10 hover:bg-primary/15 focus-visible:bg-primary/20"
            : "text-muted-foreground hover:text-foreground",
        )}
      >
        <Globe />
        <span className="ai-composer-web-value">{t(($) => $.ai.web.label)}</span>
      </Button>
    </Tooltip>
  );
}
