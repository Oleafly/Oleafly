import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Download, FlaskConical, Folder, GitBranch, Image, Search, Settings2, Sparkles, SquareTerminal } from "lucide-react";
import { useIconPackState } from "@/components/icons/icon-pack";
import { ColorIconSvg, IconPackStyles } from "@/components/icons/pack-icon";
import { Spinner } from "@/components/ui/spinner";
import { formatBytes } from "@/lib/format-bytes";
import { downloadColorIconPack, IconPackError, parseIconPack, removeColorIconPack } from "@/lib/icon-pack-install";
import { COLOR_ICON_PACK } from "@/lib/icon-pack-pin";
import { cn } from "@/lib/utils";
import { useSettingsStore } from "@/store/settings";
import { COLOR_ICON_PREVIEW } from "./icon-pack-preview";

// The same commands as the Color preview, in the same order (PREVIEW in scripts/build-icon-pack.mjs).
const NEUTRAL_PREVIEW = [Folder, Search, Settings2, Sparkles, GitBranch, FlaskConical, Image, SquareTerminal];

const optionClass = (active: boolean) =>
  cn(
    "flex flex-col items-center gap-2 rounded-md border p-3 text-xs font-medium transition-colors",
    active ? "border-primary bg-primary/5" : "border-border hover:bg-accent",
  );

/** Neutral line icons ship with Oleafly; the Color pack is downloaded the first time it is picked. */
export function IconPackCard() {
  const { t } = useTranslation(["settings"]);
  const iconPack = useSettingsStore((state) => state.iconPack);
  const setIconPack = useSettingsStore((state) => state.setIconPack);
  const { installed } = useIconPackState();
  const [downloading, setDownloading] = useState(false);
  const [failure, setFailure] = useState<IconPackError["reason"] | null>(null);
  const colorShowing = iconPack === "color" && installed !== null;
  // Four drawings ship with the app so the card can show the pack before it is downloaded.
  const preview = useMemo(() => parseIconPack(COLOR_ICON_PREVIEW), []);

  const chooseColor = async () => {
    setFailure(null);
    if (!installed) {
      setDownloading(true);
      try {
        await downloadColorIconPack();
      } catch (error) {
        setFailure(error instanceof IconPackError ? error.reason : "network");
        return;
      } finally {
        setDownloading(false);
      }
    }
    setIconPack("color");
  };

  const removeColor = () => {
    removeColorIconPack();
    setIconPack("neutral");
  };

  return (
    <div className="rounded-lg border bg-card p-3" data-testid="settings-icon-pack">
      <div className="text-sm font-medium">{t(($) => $.settings.appearance.app.iconPack.label)}</div>
      <div className="mb-2 text-xs text-muted-foreground">
        {t(($) => $.settings.appearance.app.iconPack.description)}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          data-testid="settings-icon-pack-neutral"
          aria-pressed={!colorShowing}
          onClick={() => setIconPack("neutral")}
          className={optionClass(!colorShowing)}
        >
          <div className="flex h-14 w-full flex-wrap items-center justify-center gap-3 text-muted-foreground">
            {NEUTRAL_PREVIEW.map((Icon) => (
              <Icon key={Icon.displayName} aria-hidden className="size-5" />
            ))}
          </div>
          {t(($) => $.settings.appearance.app.iconPack.neutral)}
        </button>
        <button
          type="button"
          data-testid="settings-icon-pack-color"
          aria-pressed={colorShowing}
          disabled={downloading}
          onClick={() => void chooseColor()}
          className={optionClass(colorShowing)}
        >
          <div className="flex h-14 w-full flex-wrap items-center justify-center gap-3 text-muted-foreground">
            {Object.entries(preview.icons).map(([name, drawing]) => (
              <ColorIconSvg key={name} name={name} drawing={drawing} className="size-5" />
            ))}
          </div>
          {t(($) => $.settings.appearance.app.iconPack.color)}
          {installed ? null : (
            <span className="flex items-center gap-1 font-normal text-muted-foreground" data-testid="settings-icon-pack-download">
              {downloading ? <Spinner size="sm" /> : <Download aria-hidden className="size-3.5" />}
              {downloading
                ? t(($) => $.settings.appearance.app.iconPack.downloading)
                : t(($) => $.settings.appearance.app.iconPack.download, { size: formatBytes(COLOR_ICON_PACK.bytes) })}
            </span>
          )}
        </button>
      </div>
      {colorShowing ? null : <IconPackStyles pack={preview} id="color-preview" />}
      {failure ? (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {failure === "network"
            ? t(($) => $.settings.appearance.app.iconPack.failedNetwork)
            : t(($) => $.settings.appearance.app.iconPack.failedCheck)}
        </p>
      ) : null}
      {installed ? (
        <button
          type="button"
          onClick={removeColor}
          className="mt-2 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          {t(($) => $.settings.appearance.app.iconPack.remove)}
        </button>
      ) : null}
    </div>
  );
}
