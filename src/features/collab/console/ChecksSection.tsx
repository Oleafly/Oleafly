import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Activity } from "@/components/icons/pack";
import { Button } from "@/components/ui/button";
import { LoadingState } from "@/components/ui/empty";
import { ConnectionChecks } from "../ConnectionChecks";
import { InlineAlert } from "../feedback";
import { useConnectionTest } from "../use-connection-test";

export function ChecksSection({ url }: Readonly<{ url: string }>) {
  const { t } = useTranslation(["collab"]);
  const { test, run } = useConnectionTest(url);

  useEffect(() => {
    void run();
  }, [run]);

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">{t(($) => $.collab.console.checks.description)}</p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={test.state === "running"}
        onClick={() => void run()}
      >
        <Activity aria-hidden />
        {t(($) => $.collab.section.server.test)}
      </Button>
      {test.state === "running" ? (
        <LoadingState size="compact" label={t(($) => $.collab.section.checks.running)} />
      ) : null}
      {test.state === "done" ? <ConnectionChecks checks={test.checks} /> : null}
      {test.state === "failed" ? <InlineAlert>{test.message}</InlineAlert> : null}
    </div>
  );
}
