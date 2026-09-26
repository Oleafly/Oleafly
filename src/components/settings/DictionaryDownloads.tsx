import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { BookA, Info, Trash2 } from "lucide-react";
import type { DictionaryInfo } from "@oleafly/backend-port";
import { Tooltip } from "@/components/ui/tooltip";
import { currentLocale } from "@/i18n";
import { formatDownloadSize } from "@/lib/download-size";
import { logError } from "@/lib/log";
import {
  DEFAULT_DICTIONARY_LOCALE,
  dictionaryLabel,
  loadDictionaryCatalog,
  normalizeDictionaryLocale,
  refreshDictionaryCatalog,
} from "@/lib/proofreading/dictionary-catalog";
import { forgetProofreadingDictionary } from "@/lib/proofreading/client";
import { notifyError } from "@/lib/toast";
import { removeDictionary, setProjectDictionaryLocaleCmd } from "@/lib/tauri";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";

async function resetOpenProjectLocale(locale: string): Promise<boolean> {
  const { projectId, projectDictionaryLocale } = useFilesStore.getState();
  if (
    !projectId ||
    !projectDictionaryLocale ||
    normalizeDictionaryLocale(projectDictionaryLocale) !== locale
  ) {
    return false;
  }
  try {
    const meta = await setProjectDictionaryLocaleCmd(projectId, null);
    if (useFilesStore.getState().projectId !== projectId) return false;
    useFilesStore.setState({
      projectDictionaryLocale: meta.dictionary_locale ?? null,
    });
    return true;
  } catch (error) {
    void logError("reset the project spelling language", error);
    return false;
  }
}

export function DictionaryDownloads() {
  const { t } = useTranslation(["common", "settings"]);
  const [entries, setEntries] = useState<DictionaryInfo[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    loadDictionaryCatalog()
      .then(setEntries)
      .catch((error) => void logError("list spelling dictionaries", error));
  }, []);

  const remove = useCallback(
    async (entry: DictionaryInfo) => {
      setBusyId(entry.id);
      try {
        await removeDictionary(entry.id);
      } catch (error) {
        notifyError(
          "remove the spelling dictionary",
          error,
          t(($) => $.settings.engine.packages.error.remove, {
            name: dictionaryLabel(entry, currentLocale()),
          }),
        );
        setBusyId(null);
        return;
      }
      const removed = normalizeDictionaryLocale(entry.id);
      const restarted = forgetProofreadingDictionary(removed);
      const settings = useSettingsStore.getState();
      let announced = false;
      if (normalizeDictionaryLocale(settings.dictionaryLocale) === removed) {
        settings.setDictionaryLocale(DEFAULT_DICTIONARY_LOCALE);
        announced = true;
      }
      if (await resetOpenProjectLocale(removed)) announced = true;
      if (restarted && !announced) {
        const current = useSettingsStore.getState();
        window.dispatchEvent(
          new CustomEvent("oleafly:proofreading-settings-changed", {
            detail: {
              setting: "dictionaryRemoved",
              spellcheck: current.spellcheck,
              harper: current.harper,
            },
          }),
        );
      }
      try {
        setEntries(await refreshDictionaryCatalog());
      } catch (error) {
        void logError("list spelling dictionaries", error);
      } finally {
        setBusyId(null);
      }
    },
    [t],
  );

  const uiLocale = currentLocale();
  const installed = entries.filter((entry) => entry.state === "installed");

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-1.5">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t(($) => $.settings.downloads.dictionaries.heading)}
        </h3>
        <Tooltip
          wide
          side="right"
          label={t(($) => $.settings.downloads.dictionaries.tooltip)}
        >
          <Info className="size-3.5 cursor-help text-muted-foreground/60 hover:text-muted-foreground" />
        </Tooltip>
      </div>

      <div className="overflow-hidden rounded-lg border">
        {installed.length === 0 ? (
          <p className="px-3 py-4 text-sm text-muted-foreground">
            {t(($) => $.settings.downloads.dictionaries.empty)}
          </p>
        ) : (
          installed.map((entry) => (
            <div
              key={entry.id}
              data-testid={`dictionary-row-${entry.id}`}
              className="flex items-center gap-3 border-b px-3 py-2.5 last:border-b-0"
            >
              <BookA className="size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">
                    {dictionaryLabel(entry, uiLocale)}
                  </span>
                  {entry.bytes > 0 && (
                    <span className="text-[11px] text-muted-foreground">
                      {formatDownloadSize(entry.bytes)}
                    </span>
                  )}
                </div>
                <p className="truncate text-[11px] text-muted-foreground">
                  {entry.id}
                  {entry.license.id ? ` · ${entry.license.id}` : ""}
                </p>
              </div>
              <button
                type="button"
                data-testid={`dictionary-remove-${entry.id}`}
                onClick={() => void remove(entry)}
                disabled={busyId !== null}
                className="inline-flex items-center gap-1.5 rounded-md border border-input px-2.5 py-1.5 text-xs hover:bg-accent disabled:opacity-50"
              >
                <Trash2 className="size-3.5" /> {t(($) => $.common.actions.remove)}
              </button>
            </div>
          ))
        )}
      </div>

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        {t(($) => $.settings.downloads.dictionaries.note)}
      </p>
    </div>
  );
}
