import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { describeError } from "@/lib/app-error";
import { logError } from "@/lib/log";
import { compiledHtmlPreviewUrl } from "@/lib/notebook-commands";
import { openHtmlInBrowser } from "./open-compiled-html";

const FRAME_SANDBOX = "allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-downloads";

type Frame = { projectId: string; builtAt: number } & ({ url: string } | { error: string });

function pageName(url: string): string {
  return decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "");
}

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
  const [frame, setFrame] = useState<Frame | null>(null);
  useEffect(() => {
    if (builtAt === null) return;
    let current = true;
    compiledHtmlPreviewUrl(projectId).then(
      (url) => {
        if (current) setFrame({ projectId, builtAt, url });
      },
      (error: unknown) => {
        void logError("preview compiled HTML", error);
        if (current) setFrame({ projectId, builtAt, error: describeError(error) });
      },
    );
    return () => {
      current = false;
    };
  }, [projectId, builtAt]);
  const shown = builtAt !== null && frame?.projectId === projectId ? frame : null;
  if (shown && "url" in shown) {
    return (
      <div className="h-full" data-testid="html-output-panel">
        <iframe
          key={shown.url}
          title={pageName(shown.url)}
          src={`${shown.url}?v=${shown.builtAt}`}
          sandbox={FRAME_SANDBOX}
          allow="fullscreen"
          className="size-full border-0 bg-white"
        />
      </div>
    );
  }
  const failure = shown && "error" in shown ? shown.error : null;
  const building = builtAt === null && compiling;
  const waiting = builtAt !== null && failure === null;
  const title = () => {
    if (failure !== null) return failure;
    if (building) return t(($) => $.preview.html.building);
    if (builtAt === null) return t(($) => $.preview.html.pendingTitle);
    return null;
  };
  return (
    <div className="flex h-full items-center justify-center px-6" data-testid="html-output-panel">
      <div className="space-y-3 text-center text-muted-foreground" role="status" aria-live="polite">
        {building || waiting ? (
          <Spinner className="mx-auto size-10" />
        ) : (
          <Globe aria-hidden className="mx-auto size-10 opacity-30" />
        )}
        {title() && <p className="mx-auto max-w-xs text-sm font-medium text-foreground">{title()}</p>}
        <div className="flex flex-wrap items-center justify-center gap-2">
          {failure !== null && (
            <Button size="sm" onClick={() => void openHtmlInBrowser(projectId)}>
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
    </div>
  );
}
