import { IntegrationError } from "@/components/settings/IntegrationCard";
import { Button } from "@/components/ui/button";
import { ModalShell } from "@/components/ui/modal-shell";
import { Spinner } from "@/components/ui/spinner";
import { describeError } from "@/lib/app-error";
import { cloudProviderName } from "@/lib/cloud-providers";
import { activeCloudProvider, useCloudStore } from "@/store/cloud";
import { useId } from "react";
import { useTranslation } from "react-i18next";
import { useCatalogUpdates } from "@/i18n/use-catalog-updates";

export function CloudSettingsChoiceDialog() {
  const { t } = useTranslation(["common", "cloud"]);
  useCatalogUpdates("cloud");
  const titleId = useId();
  const descriptionId = useId();
  const choice = useCloudStore((s) => s.settingsChoice);
  const busy = useCloudStore((s) => s.settingsChoiceBusy);
  const error = useCloudStore((s) => s.settingsChoiceError);
  const chooseSettings = useCloudStore((s) => s.chooseSettings);
  const deferSettingsChoice = useCloudStore((s) => s.deferSettingsChoice);
  const kind = useCloudStore(activeCloudProvider);

  if (!choice || choice.deferred) return null;
  const provider = cloudProviderName(kind);

  return (
    <ModalShell
      open
      onClose={deferSettingsChoice}
      closeLabel={t(($) => $.common.actions.close)}
      layer="nested"
      width="md"
      role="alertdialog"
      labelledBy={titleId}
      describedBy={descriptionId}
      testId="cloud-settings-choice"
      className="p-5"
    >
      <h2 id={titleId} className="text-sm font-semibold">
        {t(($) => $.cloud.choice.title)}
      </h2>
      <p id={descriptionId} className="mt-2 select-text text-xs leading-relaxed text-muted-foreground">
        {t(($) => $.cloud.choice.description, { provider })}
      </p>
      {error ? (
        <div className="mt-3">
          <IntegrationError>{describeError(error)}</IntegrationError>
        </div>
      ) : null}
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy}
          data-modal-initial-focus
          data-testid="cloud-settings-keep-local"
          onClick={() => void chooseSettings("local")}
        >
          {t(($) => $.cloud.choice.keepLocal)}
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={busy}
          data-testid="cloud-settings-use-cloud"
          onClick={() => void chooseSettings("cloud")}
        >
          {busy ? <Spinner /> : null}
          {t(($) => $.cloud.choice.useCloud, { provider })}
        </Button>
      </div>
    </ModalShell>
  );
}
