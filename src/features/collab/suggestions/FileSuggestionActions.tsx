import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { formatNumber } from "@/lib/intl";
import { basename } from "@/lib/path-utils";
import { commentFailure } from "../comments/refusals";
import { InlineAlert } from "../feedback";
import { acceptFile, rejectFile } from "./suggestions-store";

export function FileSuggestionActions({ path, pending }: Readonly<{ path: string; pending: number }>) {
  const { t } = useTranslation(["collab"]);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const file = basename(path);
  if (pending === 0) return null;
  const run = (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    action()
      .catch((error_: unknown) => setError(commentFailure(error_)))
      .finally(() => setBusy(false));
  };
  return (
    <div className="space-y-1.5 px-1 pb-1">
      <fieldset
        aria-label={t(($) => $.collab.suggestions.fileActions, { file })}
        className="m-0 flex flex-wrap items-center gap-1.5 border-0 p-0"
      >
        <Button type="button" variant="outline" size="xs" disabled={busy} onClick={() => run(() => acceptFile(path))}>
          {t(($) => $.collab.suggestions.acceptAll)}
        </Button>
        <Button type="button" variant="outline" size="xs" disabled={busy} onClick={() => setConfirming(true)}>
          {t(($) => $.collab.suggestions.rejectAll)}
        </Button>
      </fieldset>
      {error ? <InlineAlert>{error}</InlineAlert> : null}
      <ConfirmationDialog
        open={confirming}
        title={t(($) => $.collab.suggestions.rejectAllConfirm.title, { file })}
        description={t(($) => $.collab.suggestions.rejectAllConfirm.description, { number: formatNumber(pending) })}
        confirmLabel={t(($) => $.collab.suggestions.rejectAllConfirm.confirm)}
        destructive
        onConfirm={() => {
          setConfirming(false);
          run(() => rejectFile(path));
        }}
        onCancel={() => setConfirming(false)}
      />
    </div>
  );
}
