import { useTranslation } from "react-i18next";
import { Tooltip } from "@/components/ui/tooltip";
import { AgentLogo } from "@/components/ai/acp/AgentLogo";
import { cn } from "@/lib/utils";

export interface AgentPickerEntry {
  id: string;
  name: string;
  available: boolean;
  hint?: string;
}

export function AgentPickerRow({
  agents,
  selectedId,
  disabled,
  onSelect,
}: Readonly<{
  agents: readonly AgentPickerEntry[];
  selectedId: string | null;
  disabled?: boolean;
  onSelect: (id: string) => void;
}>) {
  const { t } = useTranslation(["common", "ai"]);
  if (agents.length === 0) return null;
  return (
    <fieldset
      aria-label={t(($) => $.ai.agents.pickerAriaLabel)}
      data-testid="agent-picker-row"
      className="no-scrollbar mx-auto flex w-fit max-w-full items-center gap-0.5 overflow-x-auto rounded-full border bg-muted/60 p-1"
    >
      {agents.map((agent) => {
        const selected = agent.id === selectedId;
        const label = agent.available
          ? agent.name
          : t(($) => $.ai.agents.unavailableTooltip, {
              name: agent.name,
              hint: agent.hint ?? t(($) => $.ai.agents.notInstalled),
            });
        return (
          <Tooltip key={agent.id} label={label}>
            <button
              type="button"
              aria-pressed={selected}
              aria-label={agent.name}
              data-testid={`agent-picker-${agent.id}`}
              data-available={agent.available ? "true" : "false"}
              disabled={disabled}
              onClick={() => onSelect(agent.id)}
              className={cn(
                "flex h-9 shrink-0 items-center gap-2 rounded-full transition-colors disabled:cursor-not-allowed",
                selected
                  ? "bg-background px-3.5 text-sm font-medium text-foreground shadow-sm"
                  : "w-9 justify-center text-muted-foreground hover:bg-accent hover:text-foreground",
                !agent.available && !selected && "opacity-40 hover:opacity-70",
              )}
            >
              <AgentLogo agentId={agent.id} size={18} />
              {selected ? <span className="whitespace-nowrap">{agent.name}</span> : null}
            </button>
          </Tooltip>
        );
      })}
    </fieldset>
  );
}
