import { Globe, Loader2, Plus, X } from "lucide-react";
import { Tooltip } from "@/components/ui/tooltip";
import { cn, isMac } from "@/lib/utils";
import { tabText } from "./address";
import type { BrowserTab } from "./browser-state";

interface TabStripProps {
  tabs: BrowserTab[];
  active: string | null;
  onActivate: (label: string) => void;
  onClose: (label: string) => void;
  onNewTab: () => void;
}

export function TabStrip({ tabs, active, onActivate, onClose, onNewTab }: TabStripProps) {
  return (
    <div
      data-tauri-drag-region
      className={cn(
        "flex h-9 shrink-0 items-end gap-1 overflow-hidden bg-muted/40 px-2 pt-1",
        isMac && "pl-[78px]",
      )}
    >
      <div role="tablist" aria-label="Open tabs" className="flex min-w-0 flex-1 items-end gap-1 overflow-hidden">
        {tabs.map((tab) => {
          const selected = tab.label === active;
          const text = tabText(tab);
          return (
            <div
              key={tab.label}
              role="tab"
              aria-selected={selected}
              tabIndex={selected ? 0 : -1}
              onKeyDown={(event) => {
                if (event.target !== event.currentTarget) return;
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onActivate(tab.label);
                }
              }}
              data-testid="browser-tab"
              data-label={tab.label}
              className={cn(
                "group flex h-8 min-w-0 max-w-56 flex-1 items-center gap-1 rounded-t-md border border-b-0 pl-2 pr-1 text-xs transition-colors",
                selected
                  ? "border-border bg-background text-foreground"
                  : "border-transparent bg-transparent text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              <button
                type="button"
                onClick={() => onActivate(tab.label)}
                className="flex min-w-0 flex-1 items-center gap-1.5 text-left outline-none focus-visible:ring-1 focus-visible:ring-ring"
                title={text}
              >
                {tab.loading ? (
                  <Loader2 className="size-3.5 shrink-0 animate-spin" aria-hidden />
                ) : (
                  <Globe className="size-3.5 shrink-0" aria-hidden />
                )}
                <span className="truncate">{text}</span>
              </button>
              <button
                type="button"
                aria-label="Close tab"
                onClick={() => onClose(tab.label)}
                className={cn(
                  "flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
                  !selected && "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
                )}
              >
                <X className="size-3" aria-hidden />
              </button>
            </div>
          );
        })}
      </div>
      <Tooltip label="New tab" side="bottom">
        <button
          type="button"
          aria-label="New tab"
          onClick={onNewTab}
          className="mb-0.5 flex size-7 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <Plus className="size-4" aria-hidden />
        </button>
      </Tooltip>
    </div>
  );
}
