import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { useSettingsStore } from "@/store/settings";

function openSearchKeySettings() {
  const settings = useSettingsStore.getState();
  settings.setSettingsInitialSection("integrations");
  settings.setSettingsScrollTarget("citation-search");
  settings.setSettingsOpen(true);
}

export function RunNotice({ text }: Readonly<{ text: string }>) {
  const { t } = useTranslation(["common", "ai"]);
  const needsSearchKey = text === t(($) => $.ai.web.searchUnavailable);
  return (
    <div
      data-testid="agent-notice"
      className="flex max-w-[85%] flex-wrap items-center gap-x-2 gap-y-1.5 rounded-md border border-border/70 bg-muted/40 px-2.5 py-1.5 text-[0.6875rem] leading-snug text-muted-foreground"
    >
      <p className="select-text">{text}</p>
      {needsSearchKey ? (
        <Button type="button" variant="outline" size="xs" onClick={openSearchKeySettings}>
          {t(($) => $.ai.web.addSearchKey)}
        </Button>
      ) : null}
    </div>
  );
}
