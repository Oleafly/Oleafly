import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { listen } from "@tauri-apps/api/event";
import { Check, ChevronDown, ChevronRight, Download, FileText, Info, Loader2, Sparkles, Trash2, Type } from "lucide-react";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { E2E_HOOKS } from "@/lib/e2e-flags";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip } from "@/components/ui/tooltip";
import { i18n } from "@/i18n";
import { formatNumber } from "@/lib/intl";
import { logError } from "@/lib/log";
import { notifyError, toast } from "@/lib/toast";
import { useSettingsStore } from "@/store/settings";
import {
  deleteCustomTemplate,
  downloadAllFonts,
  installFontComponent,
  installTemplatePack,
  listFontComponents,
  listTemplatePacks,
  listTemplates,
  refreshPackCatalog,
  removeFontComponent,
  removeTemplatePack,
  templatePreview,
  type AssetProgress,
  type ComponentInfo,
  type PackInfo,
  type TemplateInfo,
} from "@/lib/tauri";

const ALL = "__all__";

const FONT_PACK_IDS = ["lato", "ptsans", "ptserif"] as const;
type FontPackId = (typeof FONT_PACK_IDS)[number];

function isFontPackId(id: string): id is FontPackId {
  return (FONT_PACK_IDS as readonly string[]).includes(id);
}

function formatSize(bytes: number): string {
  if (!bytes) return "";
  const mb = bytes / 1_000_000;
  if (mb >= 1) {
    const digits = mb >= 10 ? 0 : 1;
    return i18n.t(($) => $.settings.downloads.size.megabytes, {
      value: formatNumber(mb, { minimumFractionDigits: digits, maximumFractionDigits: digits }),
    });
  }
  return i18n.t(($) => $.settings.downloads.size.kilobytes, {
    value: formatNumber(Math.max(1, Math.round(bytes / 1000))),
  });
}

export function DownloadsSection() {
  const { t } = useTranslation(["common", "settings"]);
  const [components, setComponents] = useState<ComponentInfo[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [progress, setProgress] = useState("");

  const templatesHeadingRef = useRef<HTMLHeadingElement>(null);
  const [tab, setTab] = useState<"fonts" | "templates">("fonts");
  const [aiOpen, setAiOpen] = useState(false);
  const [aiTemplates, setAiTemplates] = useState<TemplateInfo[]>([]);
  const [aiPreviews, setAiPreviews] = useState<Record<string, string>>({});
  const [aiConfirm, setAiConfirm] = useState<TemplateInfo | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const refreshAiTemplates = useCallback(async () => {
    try {
      const all = await listTemplates();
      const ai = all.filter((t) => (t.category || "") === "AI Generated");
      setAiTemplates(ai);
      for (const t of ai) {
        void templatePreview(t.id)
          .then((uri) => {
            if (uri) setAiPreviews((prev) => ({ ...prev, [t.id]: uri }));
          })
          .catch(() => {});
      }
    } catch (e) {
      void logError("list AI templates", e);
    }
  }, []);
  useEffect(() => {
    if (aiOpen) void refreshAiTemplates();
  }, [aiOpen, refreshAiTemplates]);
  const scrollTarget = useSettingsStore((s) => s.settingsScrollTarget);
  const setScrollTarget = useSettingsStore((s) => s.setSettingsScrollTarget);
  useEffect(() => {
    if (scrollTarget !== "templates") return;
    setTab("templates");
    setScrollTarget(null);
  }, [scrollTarget, setScrollTarget]);

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
          setProgress(
            t(($) => $.settings.downloads.progress, {
              label: p.label,
              index: formatNumber(p.index),
              total: formatNumber(p.total),
            }),
          );
        });
        await run();
        await refresh();
      } catch (e) {
        notifyError(verb, e);
      } finally {
        unlisten?.();
        setBusyId(null);
        setProgress("");
      }
    },
    [refresh, t],
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
      notifyError("remove the font", e);
    } finally {
      setBusyId(null);
    }
  };

  const anyBusy = busyId !== null;
  const allInstalled = components.length > 0 && components.every((c) => c.installed);

  const [packs, setPacks] = useState<PackInfo[]>([]);
  const [packBusyId, setPackBusyId] = useState<string | null>(null);
  const [packProgress, setPackProgress] = useState("");

  const refreshPacks = useCallback(async () => {
    try {
      await refreshPackCatalog().catch(() => {});
      setPacks(await listTemplatePacks());
    } catch (e) {
      void logError("list template packs", e);
    }
  }, []);

  useEffect(() => {
    void refreshPacks();
  }, [refreshPacks]);

  const runPackInstall = async (id: string) => {
    let unlisten: (() => void) | undefined;
    try {
      unlisten = await listen<AssetProgress>("asset-progress", (e) => {
        const p = e.payload;
        if (p.component === id)
          setPackProgress(
            t(($) => $.settings.downloads.packProgress, {
              index: formatNumber(p.index),
              total: formatNumber(p.total),
            }),
          );
      });
      await installTemplatePack(id);
      await refreshPacks();
    } finally {
      unlisten?.();
      setPackProgress("");
    }
  };

  const installPack = async (id: string) => {
    setPackBusyId(id);
    try {
      await runPackInstall(id);
    } catch (e) {
      notifyError("download the template pack", e);
    } finally {
      setPackBusyId(null);
    }
  };

  const downloadAllPacks = async () => {
    setPackBusyId(ALL);
    try {
      for (const p of packs) {
        if (p.installed) continue;
        await runPackInstall(p.id);
      }
    } catch (e) {
      notifyError("download the template packs", e);
    } finally {
      setPackBusyId(null);
    }
  };

  const removePack = async (id: string) => {
    setPackBusyId(id);
    try {
      await removeTemplatePack(id);
      await refreshPacks();
    } catch (e) {
      notifyError("remove the template pack", e);
    } finally {
      setPackBusyId(null);
    }
  };

  const anyPackBusy = packBusyId !== null;
  const allPacksInstalled = packs.length > 0 && packs.every((p) => p.installed);

  return (
    <Tabs
      value={tab}
      onValueChange={(v) => setTab(v as "fonts" | "templates")}
      className="flex flex-col gap-5"
    >
      <TabsList className="w-fit">
        <TabsTrigger value="fonts" data-testid="downloads-tab-fonts">
          {t(($) => $.settings.downloads.tabs.fonts)}
        </TabsTrigger>
        <TabsTrigger value="templates" data-testid="downloads-tab-templates">
          {t(($) => $.settings.downloads.tabs.templates)}
        </TabsTrigger>
      </TabsList>
      <TabsContent value="fonts" className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t(($) => $.settings.downloads.fonts.heading)}
          </h3>
          <Tooltip
            wide
            side="right"
            label={t(($) => $.settings.downloads.fonts.tooltip)}
          >
            <Info className="size-3.5 cursor-help text-muted-foreground/60 hover:text-muted-foreground" />
          </Tooltip>
        </div>
        <button type="button"
          onClick={() => void downloadAll()}
          disabled={anyBusy || allInstalled}
          className="inline-flex items-center gap-1.5 rounded-md border border-input px-2.5 py-1.5 text-xs hover:bg-accent disabled:opacity-50"
        >
          {busyId === ALL ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
          {allInstalled
            ? t(($) => $.settings.downloads.actions.allDownloaded)
            : t(($) => $.settings.downloads.actions.downloadAll)}
        </button>
      </div>

      <div className="overflow-hidden rounded-lg border">
        {components.length === 0 ? (
          <p className="px-3 py-4 text-sm text-muted-foreground">
            {t(($) => $.settings.downloads.fonts.empty)}
          </p>
        ) : (
          components.map((c) => {
            const busy = busyId === c.id || (busyId === ALL && !c.installed);
            return (
              <div
                key={c.id}
                {...(E2E_HOOKS ? { "data-e2e-font-pack": c.id } : {})}
                className="flex items-center gap-3 border-b px-3 py-2.5 last:border-b-0"
              >
                <Type className="size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">
                      {isFontPackId(c.id) ? t(($) => $.settings.downloads.fontPacks[c.id as FontPackId].label) : c.label}
                    </span>
                    {c.installed && <Check className="size-3.5 text-emerald-500" />}
                    {c.approx_bytes > 0 && (
                      <span className="text-[11px] text-muted-foreground">{formatSize(c.approx_bytes)}</span>
                    )}
                  </div>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {busy && progress
                      ? progress
                      : isFontPackId(c.id)
                        ? t(($) => $.settings.downloads.fontPacks[c.id as FontPackId].description)
                        : c.description}
                    {!busy && c.license?.spdx ? ` · ${c.license.spdx}` : ""}
                  </p>
                </div>
                {c.installed ? (
                  <button type="button"
                    onClick={() => void remove(c.id)}
                    disabled={anyBusy}
                    className="inline-flex items-center gap-1.5 rounded-md border border-input px-2.5 py-1.5 text-xs hover:bg-accent disabled:opacity-50"
                  >
                    <Trash2 className="size-3.5" /> {t(($) => $.common.actions.remove)}
                  </button>
                ) : (
                  <button type="button"
                    onClick={() => void install(c.id)}
                    disabled={anyBusy}
                    className="inline-flex w-24 items-center justify-center gap-1.5 rounded-md bg-primary px-2.5 py-1.5 text-xs text-white hover:opacity-90 disabled:opacity-60"
                  >
                    {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
                    {busy ? "" : t(($) => $.settings.downloads.actions.download)}
                  </button>
                )}
              </div>
            );
          })
        )}
      </div>

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        {t(($) => $.settings.downloads.fonts.engineNote)}
      </p>
      </TabsContent>

      <TabsContent value="templates" className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <h3
            ref={templatesHeadingRef}
            className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
          >
            {t(($) => $.settings.downloads.templates.heading)}
          </h3>
          <Tooltip
            wide
            side="right"
            label={t(($) => $.settings.downloads.templates.tooltip)}
          >
            <Info className="size-3.5 cursor-help text-muted-foreground/60 hover:text-muted-foreground" />
          </Tooltip>
        </div>
        <button type="button"
          onClick={() => void downloadAllPacks()}
          disabled={anyPackBusy || allPacksInstalled}
          className="inline-flex items-center gap-1.5 rounded-md border border-input px-2.5 py-1.5 text-xs hover:bg-accent disabled:opacity-50"
        >
          {packBusyId === ALL ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
          {allPacksInstalled
            ? t(($) => $.settings.downloads.actions.allDownloaded)
            : t(($) => $.settings.downloads.actions.downloadAll)}
        </button>
      </div>

      <div className="overflow-hidden rounded-lg border">
        {packs.length === 0 ? (
          <p className="px-3 py-4 text-sm text-muted-foreground">
            {t(($) => $.settings.downloads.templates.empty)}
          </p>
        ) : (
          packs.map((p) => {
            const busy = packBusyId === p.id || (packBusyId === ALL && !p.installed);
            return (
              <div
                key={p.id}
                data-testid={`pack-row-${p.id}`}
                className="flex items-center gap-3 border-b px-3 py-2.5 last:border-b-0"
              >
                <FileText className="size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{p.label}</span>
                    {p.installed && <Check className="size-3.5 text-emerald-500" />}
                    {p.approx_bytes > 0 && (
                      <span className="text-[11px] text-muted-foreground">{formatSize(p.approx_bytes)}</span>
                    )}
                  </div>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {busy && packProgress ? packProgress : p.description}
                    {!busy && p.license_summary ? ` · ${p.license_summary}` : ""}
                  </p>
                </div>
                {p.installed ? (
                  <button type="button"
                    data-testid={`pack-remove-${p.id}`}
                    onClick={() => void removePack(p.id)}
                    disabled={anyPackBusy}
                    className="inline-flex items-center gap-1.5 rounded-md border border-input px-2.5 py-1.5 text-xs hover:bg-accent disabled:opacity-50"
                  >
                    <Trash2 className="size-3.5" /> {t(($) => $.common.actions.remove)}
                  </button>
                ) : (
                  <button type="button"
                    data-testid={`pack-install-${p.id}`}
                    onClick={() => void installPack(p.id)}
                    disabled={anyPackBusy}
                    className="inline-flex w-24 items-center justify-center gap-1.5 rounded-md bg-primary px-2.5 py-1.5 text-xs text-white hover:opacity-90 disabled:opacity-60"
                  >
                    {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
                    {busy ? "" : t(($) => $.settings.downloads.actions.download)}
                  </button>
                )}
              </div>
            );
          })
        )}
      </div>

      <div className="overflow-hidden rounded-lg border bg-card">
        <button
          type="button"
          data-testid="manage-ai-templates"
          onClick={() => setAiOpen((v) => !v)}
          aria-expanded={aiOpen}
          className="flex w-full items-center gap-1.5 p-3 text-left text-xs font-semibold hover:bg-accent/40"
        >
          <Sparkles className="size-3.5 text-primary" />
          {t(($) => $.settings.downloads.aiTemplates.toggle)}
          {aiOpen ? (
            <ChevronDown className="ml-auto size-3.5 text-muted-foreground" />
          ) : (
            <ChevronRight className="ml-auto size-3.5 text-muted-foreground" />
          )}
        </button>
        {aiOpen && (
          <div className="border-t">
            {aiTemplates.length === 0 ? (
              <p className="px-3 py-4 text-sm text-muted-foreground">
                {t(($) => $.settings.downloads.aiTemplates.empty)}
              </p>
            ) : (
              aiTemplates.map((template) => (
                <div
                  key={template.id}
                  data-testid={`ai-template-row-${template.id}`}
                  className="flex items-center gap-3 border-b px-3 py-2.5 last:border-b-0"
                >
                  {aiPreviews[template.id] ? (
                    <img
                      src={aiPreviews[template.id]}
                      alt={""}
                      className="h-14 w-11 shrink-0 rounded border border-black/10 bg-white object-cover object-top shadow-sm"
                    />
                  ) : (
                    <span className="flex h-14 w-11 shrink-0 items-center justify-center rounded border bg-muted">
                      <FileText className="size-4 text-muted-foreground" />
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <span className="text-sm font-medium">{template.name}</span>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {template.description ||
                        t(($) => $.settings.downloads.aiTemplates.fallbackDescription)}
                    </p>
                  </div>
                  <button
                    type="button"
                    data-testid={`ai-template-delete-${template.id}`}
                    onClick={() => setAiConfirm(template)}
                    disabled={aiBusy}
                    className="inline-flex items-center gap-1.5 rounded-md border border-input px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                  >
                    <Trash2 className="size-3.5" /> {t(($) => $.common.actions.delete)}
                  </button>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      <ConfirmationDialog
        open={aiConfirm !== null}
        title={t(($) => $.settings.downloads.aiTemplates.deleteTitle)}
        description={t(($) => $.settings.downloads.aiTemplates.deleteDescription, {
          name: aiConfirm?.name ?? "",
        })}
        confirmLabel={t(($) => $.common.actions.delete)}
        destructive
        onConfirm={() => {
          const target = aiConfirm;
          setAiConfirm(null);
          if (!target) return;
          setAiBusy(true);
          void deleteCustomTemplate(target.id)
            .then(() => {
              toast.success(
                t(($) => $.settings.downloads.aiTemplates.deleted, { name: target.name }),
              );
              return refreshAiTemplates();
            })
            .catch((e) => notifyError("delete the template", e))
            .finally(() => setAiBusy(false));
        }}
        onCancel={() => setAiConfirm(null)}
      />
      </TabsContent>
    </Tabs>
  );
}
