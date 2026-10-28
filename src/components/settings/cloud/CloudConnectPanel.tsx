import { IntegrationBusyButton, IntegrationError } from "@/components/settings/IntegrationCard";
import { Button } from "@/components/ui/button";
import { CollapsibleSection } from "@/components/ui/collapsible-section";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { describeError } from "@/lib/app-error";
import { logError } from "@/lib/log";
import { useCloudProviderName, useCloudStore } from "@/store/cloud";
import { open } from "@tauri-apps/plugin-shell";
import { useState } from "react";
import { useTranslation } from "react-i18next";

async function reopenSignIn(url: string) {
  try {
    await open(url);
  } catch (error) {
    void logError("cloud open sign-in", error);
  }
}

export function CloudConnectPanel() {
  const { t } = useTranslation(["common", "cloud"]);
  const flow = useCloudStore((s) => s.connectFlow);
  const kind = useCloudStore((s) => s.connectProvider);
  const pasteCode = useCloudStore(
    (s) => s.providers?.find((provider) => provider.kind === s.connectProvider)?.pasteCode ?? false,
  );
  const provider = useCloudProviderName();
  const connectBusy = useCloudStore((s) => s.connectBusy);
  const pasteBusy = useCloudStore((s) => s.pasteBusy);
  const connectError = useCloudStore((s) => s.connectError);
  const beginConnect = useCloudStore((s) => s.beginConnect);
  const submitPasteCode = useCloudStore((s) => s.submitPasteCode);
  const cancelConnect = useCloudStore((s) => s.cancelConnect);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [code, setCode] = useState("");

  if (!flow || !kind) return null;

  const pasteReady = flow.paste;

  const togglePaste = (next: boolean) => {
    setPasteOpen(next);
    if (next && !flow.paste && !connectBusy) void beginConnect(kind, true);
  };

  const submit = () => {
    if (!pasteReady || pasteBusy || !code.trim()) return;
    void submitPasteCode(code);
  };

  return (
    <div data-testid="cloud-connect-panel" className="space-y-3 rounded-lg border bg-background p-4">
      <div>
        <p className="text-sm font-semibold text-foreground">{t(($) => $.cloud.finishInBrowser)}</p>
        <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
          <Spinner size="sm" />
          {t(($) => $.cloud.waiting, { provider })}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="outline" onClick={cancelConnect}>
          {t(($) => $.common.actions.cancel)}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="link"
          className="h-auto px-1 py-0.5"
          onClick={() => void reopenSignIn(flow.authUrl)}
        >
          {t(($) => $.cloud.browserDidntOpen, { provider })}
        </Button>
      </div>
      {pasteCode || flow.paste ? (
        <CollapsibleSection
          id="cloud-paste-code"
          title={t(($) => $.cloud.pasteInstead)}
          open={pasteOpen || flow.paste}
          onOpenChange={togglePaste}
        >
          <div className="space-y-2 pt-1">
            {pasteReady ? (
              <p className="text-xs text-muted-foreground">{t(($) => $.cloud.pasteHint, { provider })}</p>
            ) : (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Spinner size="sm" />
                {t(($) => $.cloud.pastePreparing)}
              </p>
            )}
            <label className="block text-xs font-medium text-foreground" htmlFor="cloud-paste-input">
              {t(($) => $.cloud.codeLabel, { provider })}
            </label>
            <form
              className="flex items-center gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                submit();
              }}
            >
              <Input
                id="cloud-paste-input"
                value={code}
                disabled={!pasteReady}
                onChange={(event) => setCode(event.target.value)}
                autoComplete="off"
                spellCheck={false}
                className="h-8 max-w-sm"
              />
              <IntegrationBusyButton
                busy={pasteBusy}
                disabled={!pasteReady || !code.trim()}
                testId="cloud-paste-submit"
                onClick={submit}
              >
                {t(($) => $.cloud.connect)}
              </IntegrationBusyButton>
            </form>
          </div>
        </CollapsibleSection>
      ) : null}
      {connectError ? <IntegrationError>{describeError(connectError)}</IntegrationError> : null}
    </div>
  );
}
