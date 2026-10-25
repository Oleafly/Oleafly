import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { describeError } from "@/lib/app-error";
import { formatTime } from "@/lib/intl";
import { logError } from "@/lib/log";
import { openCompiledHtml } from "@/lib/notebook-commands";
import { toast } from "@/lib/toast";

export function HtmlOutputPanel({
  projectId,
  builtAt,
  compiling = false,
  onCompile,
}: Readonly<{
  projectId: string;
  builtAt: number | null;
  compiling?: boolean;
  onCompile?: () => void;
}>) {
  const { t } = useTranslation(["preview"]);
  const [opening, setOpening] = useState(false);
  const open = async () => {
    setOpening(true);
    try {
      await openCompiledHtml(projectId);
    } catch (error) {
      void logError("open compiled HTML", error);
      toast.errorUnique(`open-html:${projectId}`, describeError(error));
    } finally {
      setOpening(false);
    }
  };
  const building = builtAt === null && compiling;
  const title = () => {
    if (builtAt !== null) return t(($) => $.preview.html.builtTitle);
    if (building) return t(($) => $.preview.html.building);
    return t(($) => $.preview.html.pendingTitle);
  };
  const detail = () => {
    if (builtAt !== null) return t(($) => $.preview.html.builtDetail, { time: formatTime(builtAt) });
    if (building) return t(($) => $.preview.html.buildingDetail);
    return t(($) => $.preview.html.pendingDetail);
  };
  return (
    <div
      className="space-y-3 text-center text-muted-foreground"
      data-testid="html-output-panel"
      role="status"
      aria-live="polite"
    >
      {building ? (
        <Spinner className="mx-auto size-10" />
      ) : (
        <Globe aria-hidden className="mx-auto size-10 opacity-30" />
      )}
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">{title()}</p>
        <p className="mx-auto max-w-xs text-sm">{detail()}</p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        {builtAt !== null && (
          <Button size="sm" disabled={opening} onClick={() => void open()}>
            {opening ? <Spinner size="xs" /> : null}
            {t(($) => $.preview.html.open)}
          </Button>
        )}
        {builtAt === null && !compiling && onCompile && (
          <Button size="sm" onClick={onCompile}>
            {t(($) => $.preview.html.compile)}
          </Button>
        )}
      </div>
    </div>
  );
}
