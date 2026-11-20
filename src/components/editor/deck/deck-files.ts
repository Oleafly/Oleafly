import { imageMime, isImagePath } from "@/lib/image-mime";
import { logWarning } from "@/lib/log";
import { dirname } from "@/lib/path-utils";
import { normalizeProjectPath } from "@/lib/project-intelligence/source";
import { readFileBase64 } from "@/lib/tauri";

const ASSET_IMPORT = /\bfrom\s*["']((?:\.{1,2}\/|@assets\/)[^"']+)["']/gu;
const MAX_ASSETS = 64;

export function resolveDeckImport(deckPath: string, specifier: string): string | null {
  const shared = specifier.startsWith("@assets/");
  const base = shared ? "assets" : dirname(deckPath);
  const relative = shared ? specifier.slice("@assets/".length) : specifier;
  return normalizeProjectPath(base === "." || base === "" ? relative : `${base}/${relative}`);
}

export function deckAssetImports(deckPath: string, code: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const match of code.matchAll(ASSET_IMPORT)) {
    if (found.size >= MAX_ASSETS) break;
    const specifier = match[1];
    const path = resolveDeckImport(deckPath, specifier);
    if (path && isImagePath(path)) found.set(specifier, path);
  }
  return found;
}

export async function readDeckAssets(
  projectId: string,
  imports: ReadonlyMap<string, string>,
): Promise<Record<string, string>> {
  const entries = await Promise.all(
    [...imports].map(async ([specifier, path]) => {
      try {
        return [specifier, `data:${imageMime(path)};base64,${await readFileBase64(projectId, path)}`] as const;
      } catch (cause) {
        void logWarning(`read the slide image ${path}`, cause);
        return null;
      }
    }),
  );
  return Object.fromEntries(entries.filter((entry) => entry !== null));
}
