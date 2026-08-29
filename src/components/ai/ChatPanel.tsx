import { ChatCore } from "@/components/ai/ChatCore";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { useSettingsStore } from "@/store/settings";
import { Button } from "@/components/ui/button";
import { Globe, Terminal } from "lucide-react";
import { cn } from "@/lib/utils";

export function ChatPanel() {
  const floating = useSettingsStore((s) => s.chatFloating);
  const setFloating = useSettingsStore((s) => s.setChatFloating);
  const terminalOpen = useSettingsStore((s) => s.terminalOpen);
  const setTerminalOpen = useSettingsStore((s) => s.setTerminalOpen);
  const browserOpen = useSettingsStore((s) => s.browserOpen);
  const setBrowserOpen = useSettingsStore((s) => s.setBrowserOpen);
  if (floating) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-sidebar p-6 text-center">
        <p className="text-sm text-muted-foreground">The assistant is floating over the app.</p>
        <Button size="sm" onClick={() => setFloating(false)}>Dock it back</Button>
      </div>
    );
  }
  return (
    <div className="relative h-full [&_[data-tour=ai-assistant-header]]:pl-[4.5rem]">
      <ErrorBoundary surface="assistant panel">
        <ChatCore />
      </ErrorBoundary>
      <div className="absolute left-2 top-1 z-10 flex items-center gap-0.5">
        <button
          type="button"
          title={terminalOpen ? "Close terminal dock" : "Open terminal dock"}
          aria-label={terminalOpen ? "Close terminal dock" : "Open terminal dock"}
          aria-pressed={terminalOpen}
          onClick={() => setTerminalOpen(!terminalOpen)}
          className={cn(
            "flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
            terminalOpen && "bg-accent text-foreground",
          )}
        >
          <Terminal className="size-4" />
        </button>
        <button
          type="button"
          title={browserOpen ? "Close browser dock" : "Open browser dock"}
          aria-label={browserOpen ? "Close browser dock" : "Open browser dock"}
          aria-pressed={browserOpen}
          onClick={() => setBrowserOpen(!browserOpen)}
          className={cn(
            "flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
            browserOpen && "bg-accent text-foreground",
          )}
        >
          <Globe className="size-4" />
        </button>
      </div>
    </div>
  );
}
