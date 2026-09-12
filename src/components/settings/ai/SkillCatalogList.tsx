import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { listen } from "@tauri-apps/api/event";
import { useQueryClient } from "@tanstack/react-query";
import { Download, Loader2, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { i18n } from "@/i18n";
import { describeError } from "@/lib/app-error";
import { formatDateTime, formatNumber } from "@/lib/intl";
import { SKILLS_QUERY_KEY } from "@/lib/skills";
import {
  skillsCatalog,
  skillsInstall,
  skillsUninstall,
  type SkillAssetProgress,
  type SkillCatalog,
  type SkillCatalogEntry,
} from "@/lib/tauri";

function formatBytes(bytes: number): string {
  if (!bytes) return "";
  if (bytes < 1000)
    return i18n.t(($) => $.settings.ai.skills.size.bytes, { value: formatNumber(bytes) });
  const kb = bytes / 1000;
  if (kb < 1000) {
    const digits = kb >= 10 ? 0 : 1;
    return i18n.t(($) => $.settings.ai.skills.size.kilobytes, {
      value: formatNumber(kb, { minimumFractionDigits: digits, maximumFractionDigits: digits }),
    });
  }
  const mb = kb / 1000;
  const digits = mb >= 10 ? 0 : 1;
  return i18n.t(($) => $.settings.ai.skills.size.megabytes, {
    value: formatNumber(mb, { minimumFractionDigits: digits, maximumFractionDigits: digits }),
  });
}

function formatWhen(value?: string): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return formatDateTime(parsed);
}

export function catalogSourceLine(catalog: SkillCatalog): string {
  const offline = Boolean(catalog.error);
  const when = formatWhen(catalog.fetchedAt ?? catalog.generatedAt);
  if (catalog.source === "bundled") {
    return offline
      ? i18n.t(($) => $.settings.ai.skills.catalog.source.bundledOffline)
      : i18n.t(($) => $.settings.ai.skills.catalog.source.bundled);
  }
  if (catalog.source === "cached") {
    if (when === null) {
      return offline
        ? i18n.t(($) => $.settings.ai.skills.catalog.source.cachedUnknownOffline)
        : i18n.t(($) => $.settings.ai.skills.catalog.source.cachedUnknown);
    }
    return offline
      ? i18n.t(($) => $.settings.ai.skills.catalog.source.cachedOffline, { when })
      : i18n.t(($) => $.settings.ai.skills.catalog.source.cached, { when });
  }
  if (when === null) return i18n.t(($) => $.settings.ai.skills.catalog.source.remoteUnknown);
  return i18n.t(($) => $.settings.ai.skills.catalog.source.remote, { when });
}

function progressText(entry: SkillAssetProgress): string {
  if (entry.phase === "done") return i18n.t(($) => $.settings.ai.skills.catalog.progress.finishing);
  if (entry.phase === "error")
    return entry.message || i18n.t(($) => $.settings.ai.skills.catalog.progress.failed);
  if (entry.total > 0) {
    const percent = formatNumber(Math.round((entry.received / entry.total) * 100));
    return entry.phase === "extract"
      ? i18n.t(($) => $.settings.ai.skills.catalog.progress.extractingPercent, { percent })
      : i18n.t(($) => $.settings.ai.skills.catalog.progress.downloadingPercent, { percent });
  }
  return entry.phase === "extract"
    ? i18n.t(($) => $.settings.ai.skills.catalog.progress.extracting)
    : i18n.t(($) => $.settings.ai.skills.catalog.progress.downloading);
}

export function SkillCatalogList() {
  const { t } = useTranslation(["common", "settings"]);
  const queryClient = useQueryClient();
  const [catalog, setCatalog] = useState<SkillCatalog | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [progress, setProgress] = useState<Record<string, SkillAssetProgress>>({});
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async (refresh: boolean) => {
    if (refresh) setRefreshing(true);
    else setLoading(true);
    try {
      setCatalog(await skillsCatalog(refresh));
    } catch (error) {
      setMessage({ ok: false, text: describeError(error) });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load(false);
  }, [load]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    void listen<SkillAssetProgress>("asset-progress", (event) => {
      const payload = event.payload;
      if (payload.kind !== "skill") return;
      setProgress((current) => ({ ...current, [payload.id]: payload }));
    }).then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  const clearProgress = (id: string) => {
    setProgress((current) => {
      if (!(id in current)) return current;
      const next = { ...current };
      delete next[id];
      return next;
    });
  };

  const afterDeviceChange = () => {
    void queryClient.invalidateQueries({ queryKey: SKILLS_QUERY_KEY });
  };

  const install = async (entry: SkillCatalogEntry) => {
    setBusyId(entry.id);
    setMessage(null);
    try {
      await skillsInstall(entry.id);
      clearProgress(entry.id);
      await load(false);
      afterDeviceChange();
      setMessage({
        ok: true,
        text: t(($) => $.settings.ai.skills.catalog.messages.installed, { name: entry.name }),
      });
    } catch (error) {
      setMessage({ ok: false, text: describeError(error) });
    } finally {
      setBusyId(null);
    }
  };

  const uninstall = async (entry: SkillCatalogEntry) => {
    setBusyId(entry.id);
    setMessage(null);
    try {
      await skillsUninstall(entry.id);
      await load(false);
      afterDeviceChange();
      setMessage({
        ok: true,
        text: t(($) => $.settings.ai.skills.catalog.messages.removed, { name: entry.name }),
      });
    } catch (error) {
      setMessage({ ok: false, text: describeError(error) });
    } finally {
      setBusyId(null);
    }
  };

  const shelfEntries = (catalog?.skills ?? []).filter((entry) => !entry.bundled);
  const sourceLine = catalog ? catalogSourceLine(catalog) : "";

  return (
    <div className="space-y-2 rounded-md border bg-card p-3" data-testid="skills-catalog-section">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium">{t(($) => $.settings.ai.skills.catalog.title)}</p>
          <p className="max-w-2xl text-xs leading-relaxed text-muted-foreground">
            {t(($) => $.settings.ai.skills.catalog.description)}
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          data-testid="skills-catalog-refresh"
          onClick={() => void load(true)}
          disabled={loading || refreshing}
        >
          {refreshing ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <RefreshCw className="size-3.5" />
          )}
          {t(($) => $.settings.ai.skills.catalog.refresh)}
        </Button>
      </div>

      {loading ? (
        <p className="text-xs text-muted-foreground">
          {t(($) => $.settings.ai.skills.catalog.loading)}
        </p>
      ) : null}
      {!loading && (shelfEntries.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {t(($) => $.settings.ai.skills.catalog.empty)}
        </p>
      ) : (
        <div className="space-y-2">
          {shelfEntries.map((entry) => {
            const busy = busyId === entry.id;
            const entryProgress = progress[entry.id];
            return (
              <div
                key={entry.id}
                data-testid={`skill-shelf-row-${entry.id}`}
                className="flex items-center gap-3 rounded-md border px-3 py-2.5"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{entry.name}</span>
                    {entry.domain ? (
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                        {entry.domain}
                      </span>
                    ) : null}
                  </div>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {busy && entryProgress
                      ? progressText(entryProgress)
                      : `${entry.description} · ${entry.license} · ${formatBytes(entry.bytes)}`}
                  </p>
                </div>
                {entry.installed ? (
                  <div className="flex shrink-0 items-center gap-1.5">
                    {entry.updateAvailable ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        data-testid={`skill-shelf-update-${entry.id}`}
                        onClick={() => void install(entry)}
                        disabled={busy}
                      >
                        {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
                        {t(($) => $.settings.ai.skills.catalog.update)}
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      data-testid={`skill-shelf-uninstall-${entry.id}`}
                      onClick={() => void uninstall(entry)}
                      disabled={busy}
                    >
                      <Trash2 className="size-3.5" />
                      {t(($) => $.settings.ai.skills.catalog.uninstall)}
                    </Button>
                  </div>
                ) : (
                  <Button
                    type="button"
                    size="sm"
                    data-testid={`skill-shelf-install-${entry.id}`}
                    onClick={() => void install(entry)}
                    disabled={busy}
                  >
                    {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
                    {t(($) => $.settings.ai.skills.catalog.install)}
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      ))}

      {catalog ? <p className="text-[11px] text-muted-foreground">{sourceLine}</p> : null}

      {message ? (
        <div
          role={message.ok ? "status" : "alert"}
          aria-live="polite"
          className={
            message.ok
              ? "rounded-md border border-emerald-500/30 bg-emerald-500/10 p-2 text-xs text-emerald-600 dark:text-emerald-400"
              : "rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive"
          }
        >
          {message.text}
        </div>
      ) : null}
    </div>
  );
}
