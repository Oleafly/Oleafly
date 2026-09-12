import { useEffect, useState } from "react";
import { CheckCircle2, ShieldQuestion, XCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { AiChrome } from "@/components/ai/AiChrome";
import type { AcpPermission } from "@/lib/acp";

function optionIcon(kind: string) {
  return kind.startsWith("reject") ? (
    <XCircle className="size-3.5" aria-hidden />
  ) : (
    <CheckCircle2 className="size-3.5" aria-hidden />
  );
}

export function PermissionCard({
  request,
  agentName,
  onChoose,
}: Readonly<{
  request: AcpPermission;
  agentName?: string;
  onChoose: (id: string, option: string | null) => Promise<void>;
}>) {
  const { t } = useTranslation(["common", "ai"]);
  const [busy, setBusy] = useState(false);
  const [expired, setExpired] = useState(request.expiresAt <= Date.now());
  useEffect(() => {
    const timer = setTimeout(() => setExpired(true), Math.max(0, request.expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [request.expiresAt]);
  const choose = (option: string | null) => {
    setBusy(true);
    void onChoose(request.id, option).finally(() => setBusy(false));
  };
  return (
    <AiChrome borderVariant="animated" contentClassName="p-3.5">
      <fieldset aria-label={t(($) => $.ai.acp.permission.ariaLabel)} className="flex flex-col gap-3">
        <div className="flex items-start gap-2.5">
          <span
            aria-hidden
            className="mt-0.5 flex size-7 shrink-0 items-center justify-center text-primary"
          >
            <ShieldQuestion className="size-5" />
          </span>
          <div className="min-w-0 flex-1 space-y-1">
            <p className="text-sm font-semibold leading-snug text-foreground">
              {agentName
                ? t(($) => $.ai.acp.permission.namedHeadline, { agent: agentName })
                : t(($) => $.ai.acp.permission.headline)}
            </p>
            <p className="text-[13px] leading-snug text-muted-foreground">{request.title}</p>
          </div>
        </div>
        {expired ? (
          <p className="text-xs text-muted-foreground">
            {t(($) => $.ai.acp.permission.expired)}
          </p>
        ) : (
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border/50 pt-2.5">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => choose(null)}
              className="text-muted-foreground hover:text-foreground"
            >
              {t(($) => $.ai.acp.permission.dismiss)}
            </Button>
            {request.options.map((option, index) => (
              <Button
                key={option.optionId}
                type="button"
                size="sm"
                variant={index === 0 ? "default" : "outline"}
                disabled={busy}
                onClick={() => choose(option.optionId)}
              >
                {optionIcon(option.kind)}
                {option.name}
              </Button>
            ))}
          </div>
        )}
      </fieldset>
    </AiChrome>
  );
}
