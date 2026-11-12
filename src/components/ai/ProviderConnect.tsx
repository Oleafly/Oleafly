import { Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import { OleaflyAssistantMascot } from "@/components/branding/OleaflyAssistantMascot";
import { Button } from "@/components/ui/button";

export function ProviderConnect({ onConnect, tour = false }: Readonly<{ onConnect: () => void; tour?: boolean }>) {
  const { t } = useTranslation(["ai"]);
  return (
    <div className="flex flex-col items-center gap-3 text-center">
      <OleaflyAssistantMascot />
      <div className="space-y-1">
        <div className="text-sm font-medium">{t(($) => $.ai.provider.connectTitle)}</div>
        <p className="mx-auto max-w-[18rem] text-xs text-muted-foreground">{t(($) => $.ai.provider.connectBody)}</p>
      </div>
      <Button data-tour={tour ? "ai-connect-provider" : undefined} onClick={onConnect}>
        <Sparkles className="size-4" />
        {t(($) => $.ai.provider.connectButton)}
      </Button>
      <button
        type="button"
        onClick={onConnect}
        className="text-[0.6875rem] text-muted-foreground hover:text-foreground"
      >
        {t(($) => $.ai.provider.runLocal)}
      </button>
    </div>
  );
}
