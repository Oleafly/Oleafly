import { Button } from "@/components/ui/button";
import { CollapsibleSection } from "@/components/ui/collapsible-section";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { useCloudStore } from "@/store/cloud";
import { open } from "@tauri-apps/plugin-shell";
import { useState } from "react";
import { useTranslation } from "react-i18next";

export function CloudConnectPanel() {
  const { t } = useTranslation(["common", "shell"]);
  const flow = useCloudStore((s) => s.connectFlow);
  const connectError = useCloudStore((s) => s.connectError);
  const beginConnect = useCloudStore((s) => s.beginConnect);
  const submitPasteCode = useCloudStore((s) => s.submitPasteCode);
  const cancelConnect = useCloudStore((s) => s.cancelConnect);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [code, setCode] = useState("");

  if (!flow) return null;

  const openPaste = (next: boolean) => {
    setPasteOpen(next);
    if (next && !flow.paste) void beginConnect(true);
  };

  return (
    <div className="space-y-3 rounded-lg border bg-background p-4">
      <div>
        <div className="text-sm font-semibold">{t(($) => $.shell.settings.data.cloud.finishInBrowser)}</div>
        <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
          <Spinner size="sm" />
          {t(($) => $.shell.settings.data.cloud.waiting)}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={cancelConnect}>
          {t(($) => $.common.actions.cancel)}
        </Button>
        <button
          type="button"
          className="text-xs font-medium text-primary hover:underline"
          onClick={() => void open(flow.authUrl)}
        >
          {t(($) => $.shell.settings.data.cloud.browserDidntOpen)}
        </button>
      </div>
      <CollapsibleSection
        id="cloud-paste-code"
        title={t(($) => $.shell.settings.data.cloud.pasteInstead)}
        open={pasteOpen}
        onOpenChange={openPaste}
      >
        <div className="space-y-2 pt-1">
          <p className="text-xs text-muted-foreground">{t(($) => $.shell.settings.data.cloud.pasteHint)}</p>
          <label className="block text-xs font-medium" htmlFor="cloud-paste-input">
            {t(($) => $.shell.settings.data.cloud.codeLabel)}
          </label>
          <div className="flex items-center gap-2">
            <Input
              id="cloud-paste-input"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void submitPasteCode(code);
              }}
              autoComplete="off"
              className="max-w-sm"
            />
            <Button size="sm" disabled={!code.trim()} onClick={() => void submitPasteCode(code)}>
              {t(($) => $.shell.settings.data.cloud.connect)}
            </Button>
          </div>
        </div>
      </CollapsibleSection>
      {connectError ? (
        <p role="alert" className="text-xs text-destructive">
          {connectError}
        </p>
      ) : null}
    </div>
  );
}
