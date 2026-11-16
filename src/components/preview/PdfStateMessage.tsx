import { AlertTriangle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

export function PdfStateMessage({
  kind,
  title,
  detail,
  onRetry,
}: Readonly<{
  kind: "loading" | "error";
  title: string;
  detail: string;
  onRetry?: () => void;
}>) {
  const { t } = useTranslation(["common", "preview"]);
  return (
    <div
      className="mx-auto flex max-w-sm flex-col items-center gap-3 text-center"
      role={kind === "error" ? "alert" : "status"}
      aria-live={kind === "error" ? "assertive" : "polite"}
    >
      {kind === "loading" ? (
        <Spinner className="size-7 text-muted-foreground" />
      ) : (
        <AlertTriangle className="size-7 text-destructive" />
      )}
      <div>
        <h2 className="text-sm font-semibold text-foreground">
          {title}
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          {detail}
        </p>
      </div>
      {onRetry && (
        <Button size="sm" onClick={onRetry}>
          {t(($) => $.preview.viewer.retry)}
        </Button>
      )}
    </div>
  );
}
