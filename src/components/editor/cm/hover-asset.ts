import { readFileBase64, readNoteFile } from "@/lib/tauri";
import { imageMime } from "@/lib/image-mime";

const MAX_BASE64_LENGTH = 8 * 1024 * 1024;

const CACHE_CAP = 16;
const PDF_THUMBNAIL_TIMEOUT_MS = 10_000;

export interface AssetThumbnail {
  readonly url: string | null;
  readonly error?: unknown;
}

const cache = new Map<string, AssetThumbnail>();

export function clearThumbnailCache(): void {
  cache.clear();
}

function remember(key: string, value: AssetThumbnail): void {
  cache.delete(key);
  cache.set(key, value);
  if (cache.size > CACHE_CAP) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
}

export async function readAssetThumbnail(projectId: string, path: string, page = 1): Promise<AssetThumbnail> {
  const key = `${projectId}\0${path}\0${page}`;
  const cached = cache.get(key);
  if (cached) {
    remember(key, cached);
    return cached;
  }

  let thumbnail: AssetThumbnail = { url: null };
  try {
    if (/\.pdf$/i.test(path)) {
      const bytes = new Uint8Array(await readNoteFile(projectId, path));
      // pdfjs-dist must stay out of synchronous import graphs (bundle
      // size and jsdom compatibility) — load the rasterizer on demand.
      const { pdfPageToPng } = await import("@/lib/pdf-image");
      thumbnail = {
        url: await pdfPageToPng(bytes, page, 1.5, undefined, { overallTimeoutMs: PDF_THUMBNAIL_TIMEOUT_MS }),
      };
    } else {
      const b64 = await readFileBase64(projectId, path);
      if (b64.length <= MAX_BASE64_LENGTH) thumbnail = { url: `data:${imageMime(path)};base64,${b64}` };
    }
  } catch (error) {
    thumbnail = { url: null, error };
  }

  remember(key, thumbnail);
  return thumbnail;
}

export async function loadAssetThumbnail(projectId: string, path: string, page = 1): Promise<string | null> {
  return (await readAssetThumbnail(projectId, path, page)).url;
}
