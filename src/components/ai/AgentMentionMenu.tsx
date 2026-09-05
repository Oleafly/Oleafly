import { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from "react";
import { Bot } from "lucide-react";
import type { DelegationTarget } from "@/lib/agent-mentions";
import type { SlashCommandMenuHandle } from "@/components/ai/SlashCommandMenu";
import { cn } from "@/lib/utils";

export const AgentMentionMenu = forwardRef<SlashCommandMenuHandle, {
  targets: readonly DelegationTarget[];
  query: string;
  onSelect: (target: DelegationTarget) => void;
  onClose: () => void;
  onActiveChange: (id: string | null) => void;
}>(({ targets, query, onSelect, onClose, onActiveChange }, ref) => {
  const matches = useMemo(() => {
    const needle = query.toLocaleLowerCase();
    return targets.filter((target) => `${target.id} ${target.label} ${target.detail}`.toLocaleLowerCase().includes(needle)).slice(0, 30);
  }, [targets, query]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedIndex = Math.max(0, matches.findIndex((target) => target.id === selectedId));
  const selected = matches[selectedIndex];
  useEffect(() => { onActiveChange(selected?.id ?? null); }, [selected?.id, onActiveChange]);
  useImperativeHandle(ref, () => ({
    handleKeyDown: (event) => {
      if (event.nativeEvent?.isComposing || (event.key === "Enter" && event.shiftKey)) return false;
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return true;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        if (matches.length) setSelectedId(matches[(selectedIndex + (event.key === "ArrowDown" ? 1 : -1) + matches.length) % matches.length].id);
        return true;
      }
      if ((event.key === "Enter" || event.key === "Tab") && selected) {
        event.preventDefault();
        onSelect(selected);
        return true;
      }
      return false;
    },
  }), [matches, onClose, onSelect, selected, selectedIndex]);
  return (
    <div id="ai-agent-mention-menu" role="listbox" aria-label="Delegate to an agent" className="absolute inset-x-0 bottom-full z-30 mb-2 max-h-72 overflow-y-auto rounded-xl border bg-popover p-1.5 text-popover-foreground shadow-lg">
      <p className="px-2 py-1 text-[11px] font-medium text-muted-foreground">Delegate a research task</p>
      {matches.length === 0 ? <p className="px-2 py-3 text-xs text-muted-foreground">No configured agents match this name.</p> : matches.map((target) => (
        <button type="button" role="option" aria-selected={target.id === selected?.id} id={`ai-agent-${target.id}`} key={target.id} onMouseDown={(event) => event.preventDefault()} onClick={() => onSelect(target)} className={cn("flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left", target.id === selected?.id ? "bg-accent" : "hover:bg-accent/50")}>
          <Bot className="size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1"><span className="block truncate text-xs font-medium">{target.label}</span><span className="block truncate text-[11px] text-muted-foreground">{target.detail}</span></span>
        </button>
      ))}
    </div>
  );
});
AgentMentionMenu.displayName = "AgentMentionMenu";
