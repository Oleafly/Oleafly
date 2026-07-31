// Async loader for the C2 hover asset thumbnails. Loads a project file and
// turns it into a data: URL (the CSP only allows img-src data:), with a small
// LRU cache so re-hovering the same \includegraphics doesn't re-read the file.
// Never throws; every failure (missing file, oversized asset, broken PDF)
// resolves to null and the null is cached too.

import { base64ToUint8Array, readFileBase64 } from "@/lib/tauri";
import { imageMime } from "@/lib/image-mime";

export const THUMBNAIL_TARGET_RE = /\.(png|jpe?g|gif|webp|bmp|svg|pdf)$/i;

// readFileBase64 returns the whole file as one base64 string; refuse anything
// whose encoded size exceeds 8 MiB rather than jam the webview decoding it.
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
): Promise<string | null> {
  const key = `${projectId}\0${path}`;
  if (cache.has(key)) {
    const cached = cache.get(key) ?? null;
    remember(key, cached); // refresh LRU recency
    return cached;
  }

  let thumbnail: string | null = null;
  try {
    const b64 = await readFileBase64(projectId, path);
    if (b64.length <= MAX_BASE64_LENGTH) {
      if (/\.pdf$/i.test(path)) {
        // pdfjs-dist must stay out of synchronous import graphs (bundle
        // size and jsdom compatibility) — load the rasterizer on demand.
        const { pdfPageToPng } = await import("@/lib/pdf-image");
        thumbnail = await pdfPageToPng(base64ToUint8Array(b64), 1, 1.5, undefined, {
          overallTimeoutMs: PDF_THUMBNAIL_TIMEOUT_MS,
        });
      } else {
        thumbnail = `data:${imageMime(path)};base64,${b64}`;
      }
    }
  } catch {
    thumbnail = null;
  }

  remember(key, thumbnail);
  return thumbnail;
}
