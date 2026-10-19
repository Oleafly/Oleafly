import { Trans, useTranslation } from "react-i18next";
import { Check, Copy } from "lucide-react";
import { open } from "@tauri-apps/plugin-shell";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useCopyStatus } from "@/components/ui/use-copy-status";
import type { ForgeDeviceStart } from "@/lib/tauri";

/** The one-time code of a browser sign-in, while Oleafly waits for the user
 * to enter it on the server's page. */
export function DeviceCodeCard({
  start,
  host,
  onCancel,
}: Readonly<{
  start: ForgeDeviceStart;
  host: string;
  onCancel: () => void;
}>) {
  const { t } = useTranslation(["common", "settings"]);
  const { copied, copy } = useCopyStatus();
  const page = start.verificationUriComplete ?? start.verificationUri;
  const openPage = () => {
    void open(page);
  };

  return (
    <div className="space-y-3 rounded-lg border bg-background p-4" data-testid="git-hosting-device">
      <div>
        <div className="text-sm font-semibold">
          {t(($) => $.settings.gitHosting.device.title, { host })}
        </div>
        <div className="text-xs text-muted-foreground">
          <Trans
            ns="settings"
            i18nKey={($) => $.settings.gitHosting.device.opened}
            values={{ url: start.verificationUri }}
            components={{
              verificationLink: (
                <button
                  type="button"
                  onClick={openPage}
                  className="rounded-sm font-medium text-primary hover:underline focus-visible:bg-primary/10"
                />
              ),
            }}
          />
        </div>
      </div>
      <div className="flex items-center justify-center gap-2 rounded-md border bg-muted/40 py-4">
        <code
          data-testid="git-hosting-device-code"
          className="select-all font-mono text-2xl font-semibold tracking-[0.25em]"
        >
          {start.userCode}
        </code>
        <Button size="sm" variant="ghost" className="ml-1" onClick={() => void copy(start.userCode)}>
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          {copied ? t(($) => $.common.actions.copied) : t(($) => $.common.actions.copy)}
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={openPage}>
          {t(($) => $.settings.gitHosting.device.open, { host })}
        </Button>
        <Button size="sm" variant="ghost" data-testid="git-hosting-device-cancel" onClick={onCancel}>
          {t(($) => $.common.actions.cancel)}
        </Button>
        <span className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
          <Spinner size="sm" />
          {t(($) => $.settings.gitHosting.device.waiting)}
        </span>
      </div>
    </div>
  );
}
