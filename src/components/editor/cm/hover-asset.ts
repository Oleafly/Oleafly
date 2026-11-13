import { readFileBase64, readNoteFile } from "@/lib/tauri";
import { imageMime } from "@/lib/image-mime";

const MAX_BASE64_LENGTH = 8 * 1024 * 1024;

const CACHE_CAP = 16;
const PDF_THUMBNAIL_TIMEOUT_MS = 10_000;

const cache = new Map<string, string | null>();

export function clearThumbnailCache(): void {
  cache.clear();
}

function remember(key: string, value: string | null): void {
  cache.delete(key);
  cache.set(key, value);
  if (cache.size > CACHE_CAP) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
}

export async function loadAssetThumbnail(
  projectId: string,
  path: string,
  page = 1,
): Promise<string | null> {
  const key = `${projectId}\0${path}\0${page}`;
  if (cache.has(key)) {
    const cached = cache.get(key) ?? null;
    remember(key, cached);
    return cached;
  }

  let thumbnail: string | null = null;
  try {
    if (/\.pdf$/i.test(path)) {
      const bytes = new Uint8Array(await readNoteFile(projectId, path));
      // pdfjs-dist must stay out of synchronous import graphs (bundle
      // size and jsdom compatibility) — load the rasterizer on demand.
      const { pdfPageToPng } = await import("@/lib/pdf-image");
      thumbnail = await pdfPageToPng(bytes, page, 1.5, undefined, {
        overallTimeoutMs: PDF_THUMBNAIL_TIMEOUT_MS,
      });
    } else {
      const b64 = await readFileBase64(projectId, path);
      if (b64.length <= MAX_BASE64_LENGTH) thumbnail = `data:${imageMime(path)};base64,${b64}`;
    }
  } catch {
    thumbnail = null;
  }

  remember(key, thumbnail);
  return thumbnail;
}
