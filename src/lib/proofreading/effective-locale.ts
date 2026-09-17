import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";
import { effectiveDictionaryLocale } from "./dictionary-catalog";

export function currentDictionaryLocale(): string {
  return effectiveDictionaryLocale({
    project: useFilesStore.getState().projectDictionaryLocale,
    global: useSettingsStore.getState().dictionaryLocale,
  });
}
