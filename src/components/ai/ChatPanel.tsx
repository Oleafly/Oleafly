import { useTranslation } from "react-i18next";
import { ResearchAssistant } from "@/components/ai/ResearchAssistant";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { useSettingsStore } from "@/store/settings";
import { Button } from "@/components/ui/button";

export function ChatPanel() {
  const { t } = useTranslation(["common", "ai"]);
  const floating = useSettingsStore((s) => s.chatFloating);
  const setFloating = useSettingsStore((s) => s.setChatFloating);
  if (floating) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-sidebar p-6 text-center">
        <p className="text-sm text-muted-foreground">{t(($) => $.ai.shell.floatingNotice)}</p>
        <Button size="sm" onClick={() => setFloating(false)}>{t(($) => $.ai.shell.dockBack)}</Button>
      </div>
    );
  }
  return (
    <div className="relative h-full">
      <ErrorBoundary surface="assistant panel">
        <ResearchAssistant />
      </ErrorBoundary>
    </div>
  );
}
