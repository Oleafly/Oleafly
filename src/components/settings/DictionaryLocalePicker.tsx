import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Download } from "lucide-react";
import type { DictionaryInfo } from "@oleafly/backend-port";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { currentLocale } from "@/i18n";
import { formatDownloadSize } from "@/lib/download-size";
import { logError } from "@/lib/log";
import {
  dictionaryLabel,
  groupDictionariesByLanguage,
  loadDictionaryCatalog,
} from "@/lib/proofreading/dictionary-catalog";
import { installDictionaryPack } from "@/lib/proofreading/dictionary-install";
import { notifyError, toast } from "@/lib/toast";
import { useSettingsStore } from "@/store/settings";
import { Spinner } from "@/components/ui/spinner";
import { CheckBadge } from "@/components/ui/check-badge";

export function DictionaryLocalePicker() {
  const { t } = useTranslation(["common", "settings", "shell"]);
  const dictionaryLocale = useSettingsStore((state) => state.dictionaryLocale);
  const setDictionaryLocale = useSettingsStore(
    (state) => state.setDictionaryLocale,
  );
  const offline = useSettingsStore((state) => state.offline);
  const [entries, setEntries] = useState<DictionaryInfo[]>([]);
  const [busy, setBusy] = useState<DictionaryInfo | null>(null);

  useEffect(() => {
    loadDictionaryCatalog()
      .then(setEntries)
      .catch((error) => void logError("list spelling dictionaries", error));
  }, []);

  const uiLocale = currentLocale();
  const groups = groupDictionariesByLanguage(entries, uiLocale);
  const selected = entries.find((entry) => entry.id === dictionaryLocale);
  const selectedLabel = selected
    ? dictionaryLabel(selected, uiLocale)
    : dictionaryLocale;

  const download = useCallback(
    async (entry: DictionaryInfo) => {
      const name = dictionaryLabel(entry, uiLocale);
      if (offline) {
        toast.error(
          t(($) => $.shell.settings.general.dictionary.offlineRefused, { name }),
        );
        return;
      }
      setBusy(entry);
      try {
        await installDictionaryPack(entry.id);
        setEntries(await loadDictionaryCatalog());
        setDictionaryLocale(entry.id);
        toast.success(
          t(($) => $.shell.settings.general.dictionary.downloaded, { name }),
        );
      } catch (error) {
        notifyError(
          "download the spelling dictionary",
          error,
          t(($) => $.shell.settings.general.dictionary.downloadFailed, {
            name,
          }),
        );
      } finally {
        setBusy(null);
      }
    },
    [offline, setDictionaryLocale, t, uiLocale],
  );

  const choose = useCallback(
    (id: string) => {
      const entry = entries.find((candidate) => candidate.id === id);
      if (!entry) return;
      if (entry.state === "available") {
        void download(entry);
        return;
      }
      setDictionaryLocale(id);
    },
    [download, entries, setDictionaryLocale],
  );

  return (
    <div className="flex flex-col items-end gap-1">
      <Select
        value={dictionaryLocale}
        onValueChange={choose}
        disabled={busy !== null}
      >
        <SelectTrigger
          data-testid="dictionary-locale-select"
          aria-label={t(($) => $.shell.settings.general.dictionary.ariaLabel)}
          className="w-[228px]"
        >
          <SelectValue>{selectedLabel}</SelectValue>
        </SelectTrigger>
        <SelectContent align="end" className="z-[100] max-h-[320px]">
          {groups.map((group) => (
            <SelectGroup key={group.language}>
              <SelectLabel>{group.language}</SelectLabel>
              {group.entries.map((entry) => (
                <SelectItem
                  key={entry.id}
                  value={entry.id}
                  data-dictionary-id={entry.id}
                  data-label={dictionaryLabel(entry, uiLocale)}
                  trailing={
                    entry.state === "available" ? (
                      <span className="inline-flex items-center gap-1 text-[0.6875rem] tabular-nums text-muted-foreground">
                        <Download className="size-3" />
                        {formatDownloadSize(entry.bytes)}
                      </span>
                    ) : (
                      <CheckBadge className="size-3.5" />
                    )
                  }
                >
                  {dictionaryLabel(entry, uiLocale)}
                </SelectItem>
              ))}
            </SelectGroup>
          ))}
        </SelectContent>
      </Select>
      {busy ? (
        <span
          data-testid="dictionary-download-progress"
          className="inline-flex items-center gap-1.5 text-[0.6875rem] text-muted-foreground"
        >
          <Spinner size="xs" />
          {t(($) => $.shell.settings.general.dictionary.downloading, {
            name: dictionaryLabel(busy, uiLocale),
          })}
        </span>
      ) : null}
    </div>
  );
}
