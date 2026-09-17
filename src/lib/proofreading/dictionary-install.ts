import { listen } from "@tauri-apps/api/event";
import type { AssetProgress } from "@oleafly/backend-port";
import { installDictionary } from "@/lib/tauri";
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
  let unlisten: (() => void) | undefined;
  try {
    if (onProgress) {
      unlisten = await listen<AssetProgress>("asset-progress", (event) => {
        if (event.payload.component === component) onProgress(event.payload);
      });
    }
    await installDictionary(locale);
  } finally {
    unlisten?.();
  }
  await refreshDictionaryCatalog();
}
