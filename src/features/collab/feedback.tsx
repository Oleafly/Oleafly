import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/empty";

export function InlineAlert({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <p role="alert" className="select-text rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
      {children}
    </p>
  );
}

export function LoadFailed({
  message,
  reason,
  onRetry,
}: Readonly<{ message: string; reason: string; onRetry: () => void }>) {
  const { t } = useTranslation(["common"]);
  return (
    <ErrorState size="compact" message={message}>
      <p className="select-text text-xs text-muted-foreground">{reason}</p>
      <Button type="button" variant="outline" size="sm" onClick={onRetry}>
        {t(($) => $.common.actions.retry)}
      </Button>
    </ErrorState>
  );
}
