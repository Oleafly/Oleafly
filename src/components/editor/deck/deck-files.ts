import { imageMime, isImagePath } from "@/lib/image-mime";
import { dirname } from "@/lib/path-utils";
import { readFileBase64 } from "@/lib/tauri";

const ASSET_IMPORT = /\bfrom\s*["']((?:\.{1,2}\/|@assets\/)[^"']+)["']/gu;
const MAX_ASSETS = 64;

export function resolveDeckImport(deckPath: string, specifier: string): string | null {
  const base = specifier.startsWith("@assets/") ? "assets" : dirname(deckPath);
  const relative = specifier.startsWith("@assets/") ? specifier.slice("@assets/".length) : specifier;
  const parts = base === "." || base === "" ? [] : base.split("/");
  for (const part of relative.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (parts.length === 0) return null;
      parts.pop();
    } else {
      parts.push(part);
    }
  }
  return parts.length > 0 ? parts.join("/") : null;
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
      } catch {
        return null;
      }
    }),
  );
  return Object.fromEntries(entries.filter((entry) => entry !== null));
}
