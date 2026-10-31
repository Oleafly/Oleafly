export interface FitSize {
  width: number;
  height: number;
  scale: number;
}

export function fitWithin(width: number, height: number, maxEdge: number | null): FitSize {
  const sourceWidth = Math.max(1, Math.round(width));
  const sourceHeight = Math.max(1, Math.round(height));
  const longest = Math.max(sourceWidth, sourceHeight);
  if (maxEdge === null || longest <= maxEdge) {
    return { width: sourceWidth, height: sourceHeight, scale: 1 };
  }
  const scale = maxEdge / longest;
  return {
    width: Math.max(1, Math.round(sourceWidth * scale)),
    height: Math.max(1, Math.round(sourceHeight * scale)),
    scale,
  };
}

export interface EncodeAttempt {
  mime: "image/png" | "image/jpeg";
  quality?: number;
}

const JPEG_QUALITIES = [0.92, 0.85, 0.75] as const;

/** Encodings to try, smallest loss first: lossless PNG for a PNG source
 * (screenshots, rendered pages), then JPEG at falling quality. WebP is
 * never an output: WebKit cannot encode it. */
export function encodeAttempts(source: string, accept: readonly string[]): EncodeAttempt[] {
  const attempts: EncodeAttempt[] = [];
  const png = accept.includes("image/png");
  if (source === "image/png" && png) attempts.push({ mime: "image/png" });
  if (accept.includes("image/jpeg")) {
    for (const quality of JPEG_QUALITIES) attempts.push({ mime: "image/jpeg", quality });
  } else if (png && attempts.length === 0) {
    attempts.push({ mime: "image/png" });
  }
  return attempts;
}

export const MAX_SHRINKS = 3;
export const SHRINK_FACTOR = 0.8;

export interface DownscaleRequest {
  bytes: ArrayBuffer;
  mime: string;
  maxEdge: number | null;
  maxBytes: number;
  accept: readonly string[];
}

export type DownscaleReply =
  | { unchanged: true }
  | { unchanged: false; bytes: ArrayBuffer; mime: string }
  | { error: "unsupported" | "too-large" | "decode" };

/** The 2D drawing calls this module makes; OffscreenCanvas and canvas
 * elements both provide them. */
export interface DownscaleContext {
  fillStyle: string | CanvasGradient | CanvasPattern;
  fillRect(x: number, y: number, width: number, height: number): void;
  drawImage(image: ImageBitmap, dx: number, dy: number, dw: number, dh: number): void;
}

export interface DownscaleCanvas {
  getContext(kind: "2d"): DownscaleContext | null;
  encode(mime: string, quality?: number): Promise<Blob | null>;
}

export interface DownscaleEnv {
  decode(blob: Blob): Promise<ImageBitmap>;
  canvas(width: number, height: number): DownscaleCanvas;
}

export async function decodeOriented(blob: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(blob, { imageOrientation: "from-image" });
  } catch (error) {
    if (error instanceof TypeError) return createImageBitmap(blob);
    throw error;
  }
}

function encodedMime(bytes: Uint8Array): string | null {
  if (bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  return null;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

function chunkType(bytes: Uint8Array, offset: number): string {
  return String.fromCodePoint(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
}

export function pngMayHaveAlpha(bytes: Uint8Array): boolean {
  if (bytes.length < 33 || PNG_SIGNATURE.some((value, index) => bytes[index] !== value)) return false;
  if (chunkType(bytes, 12) !== "IHDR") return false;
  const colorType = bytes[25];
  if (colorType === 4 || colorType === 6) return true;
  let offset = 8;
  while (offset + 8 <= bytes.length) {
    const length =
      ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
    const type = chunkType(bytes, offset + 4);
    if (type === "tRNS") return true;
    if (type === "IDAT" || type === "IEND") return false;
    offset += 12 + length;
  }
  return false;
}

function shrink(size: FitSize): FitSize {
  return {
    width: Math.max(1, Math.round(size.width * SHRINK_FACTOR)),
    height: Math.max(1, Math.round(size.height * SHRINK_FACTOR)),
    scale: size.scale * SHRINK_FACTOR,
  };
}

export async function runDownscale(request: DownscaleRequest, env: DownscaleEnv): Promise<DownscaleReply> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await env.decode(new Blob([request.bytes], { type: request.mime }));
  } catch {
    return { error: "decode" };
  }
  try {
    const fits = request.maxEdge === null || Math.max(bitmap.width, bitmap.height) <= request.maxEdge;
    if (
      request.mime === "image/png"
      && request.accept.includes("image/png")
      && fits
      && request.bytes.byteLength <= request.maxBytes
      && !pngMayHaveAlpha(new Uint8Array(request.bytes))
    ) {
      return { unchanged: true };
    }
    const attempts = encodeAttempts(request.mime, request.accept);
    if (attempts.length === 0) return { error: "unsupported" };
    let size = fitWithin(bitmap.width, bitmap.height, request.maxEdge);
    for (let round = 0; round <= MAX_SHRINKS; round += 1) {
      const canvas = env.canvas(size.width, size.height);
      const context = canvas.getContext("2d");
      if (!context) return { error: "unsupported" };
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, size.width, size.height);
      context.drawImage(bitmap, 0, 0, size.width, size.height);
      for (const attempt of attempts) {
        const blob = await canvas.encode(attempt.mime, attempt.quality);
        if (!blob || blob.size > request.maxBytes) continue;
        const bytes = await blob.arrayBuffer();
        if (encodedMime(new Uint8Array(bytes)) !== attempt.mime) continue;
        return { unchanged: false, bytes, mime: attempt.mime };
      }
      size = shrink(size);
    }
    return { error: "too-large" };
  } finally {
    bitmap.close?.();
  }
}
