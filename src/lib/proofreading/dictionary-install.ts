import type { AssetProgress } from "@oleafly/backend-port";
import { installDictionary, withAssetProgress } from "@/lib/tauri";
import { refreshDictionaryCatalog } from "./dictionary-catalog";

export const DICTIONARY_COMPONENT_PREFIX = "dictionary:";

export function dictionaryComponentId(locale: string): string {
  return `${DICTIONARY_COMPONENT_PREFIX}${locale}`;
}

export async function installDictionaryPack(
  locale: string,
  onProgress?: (progress: AssetProgress) => void,
): Promise<void> {
  const component = dictionaryComponentId(locale);
  if (onProgress) {
    await withAssetProgress(
      {
        component: (progress) => {
          if (progress.component === component) onProgress(progress);
        },
      },
      () => installDictionary(locale),
    );
  } else {
    await installDictionary(locale);
  }
  await refreshDictionaryCatalog();
}
