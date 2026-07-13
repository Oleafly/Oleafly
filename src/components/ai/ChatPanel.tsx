import { ChatCore } from "@/components/ai/ChatCore";
import { useSettingsStore } from "@/store/settings";
import { Button } from "@/components/ui/button";

export function ChatPanel() {
  const floating = useSettingsStore((s) => s.chatFloating);
  const setFloating = useSettingsStore((s) => s.setChatFloating);
  if (floating) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-sidebar p-6 text-center">
        <p className="text-sm text-muted-foreground">The assistant is floating over the app.</p>
        <Button size="sm" onClick={() => setFloating(false)}>Dock it back</Button>
      </div>
    );
  }
  return <ChatCore />;
}
