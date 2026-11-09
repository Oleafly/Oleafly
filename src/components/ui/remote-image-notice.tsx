import { ImageOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Tooltip } from "@/components/ui/tooltip";

export function RemoteImageNotice({ host, alt, onLoad }: Readonly<{ host: string; alt?: string; onLoad?: () => void }>) {
  const { t } = useTranslation(["common"]);
  const text = <span className="min-w-0 truncate">{t(($) => $.common.remoteImage.blocked, { host })}</span>;
  return (
    <span
      data-remote-image={host}
      className="inline-flex max-w-full items-center gap-2 rounded-md border border-dashed border-border px-2 py-1 align-middle text-[0.85em] text-muted-foreground"
    >
      <ImageOff aria-hidden className="size-3.5 shrink-0" />
      {alt ? (
        <Tooltip label={alt} className="min-w-0">
          {text}
        </Tooltip>
      ) : (
        text
      )}
      {onLoad && (
        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onLoad();
          }}
          className="shrink-0 rounded px-1.5 py-0.5 font-medium text-foreground transition-colors hover:bg-accent focus-visible:bg-accent"
        >
          {t(($) => $.common.remoteImage.load)}
        </button>
      )}
    </span>
  );
}
