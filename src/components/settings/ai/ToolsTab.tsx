import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { CodeBlock } from "@/components/ui/code-block";
import { SectionHeading } from "@/components/ui/section-heading";
import {
  IntegrationBusyButton,
  IntegrationCard,
  IntegrationConnected,
  IntegrationError,
} from "@/components/settings/IntegrationCard";
import { MathpixBrandIcon } from "@/components/settings/IntegrationBrandIcons";
import { ToolsModelNotice, ToolsModelPicker } from "@/components/tools/ToolsModelBar";
import { describeError } from "@/lib/app-error";
import {
  mathpixClearKeys,
  mathpixKeyStatus,
  mathpixSaveKeys,
  type MathpixKeyStatus,
} from "@/lib/mathpix";
import { toast } from "@/lib/toast";

const MATHPIX_STATUS_KEY = ["mathpix-key-status"] as const;
const MATHPIX_CONSOLE = "https://console.mathpix.com";
const OCR_PULL_COMMAND = "ollama pull glm-ocr";

function MathpixCard() {
  const { t } = useTranslation(["settings"]);
  const queryClient = useQueryClient();
  const status = useQuery({
    queryKey: MATHPIX_STATUS_KEY,
    queryFn: mathpixKeyStatus,
    staleTime: 60_000,
    retry: false,
    meta: { silent: true },
  });
  const [appId, setAppId] = useState("");
  const [appKey, setAppKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const configured = status.data?.configured === true;

  const settle = (next: MathpixKeyStatus) => {
    queryClient.setQueryData(MATHPIX_STATUS_KEY, next);
    void queryClient.invalidateQueries({ queryKey: MATHPIX_STATUS_KEY });
  };

  const save = async () => {
    if (busy || !appId.trim() || !appKey.trim()) return;
    setBusy(true);
    setError(null);
    try {
      settle(await mathpixSaveKeys(appId.trim(), appKey.trim()));
      setAppKey("");
      setAppId("");
      toast.success(t(($) => $.settings.ai.tools.mathpix.saved));
    } catch (error_) {
      setError(describeError(error_));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await mathpixClearKeys();
      settle({ configured: false, appId: null });
      toast.success(t(($) => $.settings.ai.tools.mathpix.removed));
    } catch (error_) {
      setError(describeError(error_));
    } finally {
      setBusy(false);
    }
  };

  return (
    <IntegrationCard
      testId="mathpix-card"
      framed
      icon={<MathpixBrandIcon className="size-4" />}
      title={t(($) => $.settings.ai.tools.mathpix.title)}
      description={t(($) => $.settings.ai.tools.mathpix.description)}
      docs={{ href: MATHPIX_CONSOLE, label: t(($) => $.settings.ai.tools.mathpix.docs) }}
      actions={
        configured ? (
          <IntegrationBusyButton
            busy={busy}
            variant="outline"
            testId="mathpix-remove"
            onClick={() => void remove()}
          >
            {t(($) => $.settings.ai.tools.mathpix.remove)}
          </IntegrationBusyButton>
        ) : undefined
      }
    >
      <div className="mt-3 space-y-2">
        {configured ? (
          <IntegrationConnected testId="mathpix-connected">
            {t(($) => $.settings.ai.tools.mathpix.connected, { appId: status.data?.appId ?? "" })}
          </IntegrationConnected>
        ) : (
          <form
            className="flex flex-wrap gap-2"
            aria-busy={busy}
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <Input
              data-testid="mathpix-app-id"
              value={appId}
              onChange={(event) => setAppId(event.target.value)}
              aria-label={t(($) => $.settings.ai.tools.mathpix.appIdLabel)}
              placeholder={t(($) => $.settings.ai.tools.mathpix.appIdLabel)}
              autoComplete="off"
              spellCheck={false}
              className="h-9 w-40"
            />
            <Input
              data-testid="mathpix-app-key"
              type="password"
              value={appKey}
              onChange={(event) => setAppKey(event.target.value)}
              aria-label={t(($) => $.settings.ai.tools.mathpix.appKeyLabel)}
              placeholder={t(($) => $.settings.ai.tools.mathpix.appKeyLabel)}
              autoComplete="off"
              spellCheck={false}
              className="h-9 min-w-0 flex-1"
            />
            <IntegrationBusyButton
              busy={busy}
              disabled={!appId.trim() || !appKey.trim()}
              testId="mathpix-save"
              onClick={() => void save()}
            >
              {t(($) => $.settings.ai.tools.mathpix.save)}
            </IntegrationBusyButton>
          </form>
        )}
        {error ? <IntegrationError>{error}</IntegrationError> : null}
        <p className="text-xs text-muted-foreground">{t(($) => $.settings.ai.tools.mathpix.privacy)}</p>
      </div>
    </IntegrationCard>
  );
}

export function ToolsTab() {
  const { t } = useTranslation(["settings"]);
  return (
    <div className="space-y-6" data-testid="ai-tools-tab">
      <section className="space-y-2">
        <SectionHeading>{t(($) => $.settings.ai.tools.modelTitle)}</SectionHeading>
        <p className="text-xs text-muted-foreground">{t(($) => $.settings.ai.tools.modelDescription)}</p>
        <ToolsModelPicker className="max-w-sm" />
        <div className="text-xs">
          <ToolsModelNotice scope="images" />
        </div>
        <p className="pt-2 text-xs text-muted-foreground">{t(($) => $.settings.ai.tools.ocrHint)}</p>
        <CodeBlock code={OCR_PULL_COMMAND} />
      </section>
      <MathpixCard />
    </div>
  );
}
