import { useCallback, useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { Check, Download, Info, Loader2, Trash2, Type } from "lucide-react";
import { Tooltip } from "@/components/ui/tooltip";
import { logError } from "@/lib/log";
import { notifyError } from "@/lib/toast";
import {
  downloadAllFonts,
  installFontComponent,
  listFontComponents,
  removeFontComponent,
  type AssetProgress,
  type ComponentInfo,
} from "@/lib/tauri";

const ALL = "__all__";

function formatSize(bytes: number): string {
  if (!bytes) return "";
  const mb = bytes / 1_000_000;
  if (mb >= 1) return `${mb.toFixed(mb >= 10 ? 0 : 1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1000))} KB`;
}

export function DownloadsSection() {
  const [components, setComponents] = useState<ComponentInfo[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [progress, setProgress] = useState("");

  const refresh = useCallback(async () => {
    try {
      setComponents(await listFontComponents());
    } catch (e) {
      void logError("list font components", e);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const withProgress = useCallback(
    async (id: string, run: () => Promise<void>, verb: string) => {
      setBusyId(id);
      setProgress("");
      let unlisten: (() => void) | undefined;
      try {
        unlisten = await listen<AssetProgress>("asset-progress", (e) => {
          const p = e.payload;
          setProgress(`${p.label} (${p.index} of ${p.total})`);
        });
        await run();
        await refresh();
      } catch (e) {
        notifyError(verb, e, `Couldn't ${verb}.`);
      } finally {
        unlisten?.();
        setBusyId(null);
        setProgress("");
      }
    },
    [refresh],
  );

  const install = (id: string) =>
    withProgress(id, () => installFontComponent(id), "download the font");
  const downloadAll = () =>
    withProgress(ALL, () => downloadAllFonts(), "download the fonts");
  const remove = async (id: string) => {
    setBusyId(id);
    try {
      await removeFontComponent(id);
      await refresh();
    } catch (e) {
      notifyError("remove the font", e, "Couldn't remove the font.");
    } finally {
      setBusyId(null);
    }
  };

  const anyBusy = busyId !== null;
  const allInstalled = components.length > 0 && components.every((c) => c.installed);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Fonts</h3>
          <Tooltip
            wide
            side="right"
            label="Some templates use premium open-source fonts. To keep OpenLeaf small, those fonts are downloaded on demand: when you create such a template, the fonts are fetched and copied into the project so it stays self-contained and compiles offline. You can also pre-download them here, or remove them to free space."
          >
            <Info className="size-3.5 cursor-help text-muted-foreground/60 hover:text-muted-foreground" />
          </Tooltip>
        </div>
        <button
          onClick={() => void downloadAll()}
          disabled={anyBusy || allInstalled}
          className="inline-flex items-center gap-1.5 rounded-md border border-input px-2.5 py-1.5 text-xs hover:bg-accent disabled:opacity-50"
        >
          {busyId === ALL ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
          {allInstalled ? "All downloaded" : "Download all"}
        </button>
      </div>

      <div className="overflow-hidden rounded-lg border">
        {components.length === 0 ? (
          <p className="px-3 py-4 text-sm text-muted-foreground">No downloadable fonts.</p>
        ) : (
          components.map((c) => {
            const busy = busyId === c.id || (busyId === ALL && !c.installed);
            return (
              <div key={c.id} className="flex items-center gap-3 border-b px-3 py-2.5 last:border-b-0">
                <Type className="size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{c.label}</span>
                    {c.installed && <Check className="size-3.5 text-emerald-500" />}
                    {c.approx_bytes > 0 && (
                      <span className="text-[11px] text-muted-foreground">{formatSize(c.approx_bytes)}</span>
                    )}
                  </div>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {busy && progress ? progress : c.description}
                    {!busy && c.license?.spdx ? ` · ${c.license.spdx}` : ""}
                  </p>
                </div>
                {c.installed ? (
                  <button
                    onClick={() => void remove(c.id)}
                    disabled={anyBusy}
                    className="inline-flex items-center gap-1.5 rounded-md border border-input px-2.5 py-1.5 text-xs hover:bg-accent disabled:opacity-50"
                  >
                    <Trash2 className="size-3.5" /> Remove
                  </button>
                ) : (
                  <button
                    onClick={() => void install(c.id)}
                    disabled={anyBusy}
                    className="inline-flex w-24 items-center justify-center gap-1.5 rounded-md bg-primary px-2.5 py-1.5 text-xs text-white hover:opacity-90 disabled:opacity-60"
                  >
                    {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
                    {busy ? "" : "Download"}
                  </button>
                )}
              </div>
            );
          })
        )}
      </div>

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        The LuaLaTeX engine (for tagged, accessible PDFs) is managed in the LaTeX Engine section.
      </p>
    </div>
  );
}
