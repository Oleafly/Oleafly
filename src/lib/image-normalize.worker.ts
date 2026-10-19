// Downscales and encodes one attached image off the main thread, and makes
// its thumbnail. See image-normalize.ts for the rules.
import "@/lib/polyfills";

interface WorkerScope {
  onmessage: ((event: MessageEvent<ImageJobMessage>) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
}

// Workers have FileReaderSync; the DOM library this project compiles
// against does not declare it.
declare const FileReaderSync: { new (): { readAsDataURL(blob: Blob): string } };

const workerScope = self as unknown as WorkerScope;

interface ImageJobMessage {
  id: number;
  bitmap: ImageBitmap;
  width: number;
  height: number;
  thumbWidth: number;
  thumbHeight: number;
  detectAlpha: boolean;
  encode: boolean;
}

const ENCODE_QUALITY = 0.85;
const THUMB_QUALITY = 0.7;

function hasTransparency(data: Uint8ClampedArray): boolean {
  for (let index = 3; index < data.length; index += 4) {
    if (data[index] < 255) return true;
  }
  return false;
}

async function handle(job: ImageJobMessage) {
  try {
    const thumb = new OffscreenCanvas(job.thumbWidth, job.thumbHeight);
    const thumbContext = thumb.getContext("2d");
    if (!thumbContext) throw new Error("no 2d context");
    thumbContext.fillStyle = "#ffffff";
    thumbContext.fillRect(0, 0, job.thumbWidth, job.thumbHeight);
    thumbContext.drawImage(job.bitmap, 0, 0, job.thumbWidth, job.thumbHeight);
    const thumbBlob = await thumb.convertToBlob({ type: "image/jpeg", quality: THUMB_QUALITY });
    const thumbnailUrl = new FileReaderSync().readAsDataURL(thumbBlob);
    if (!job.encode) {
      workerScope.postMessage({ id: job.id, ok: true, thumbnailUrl });
      return;
    }
    const canvas = new OffscreenCanvas(job.width, job.height);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("no 2d context");
    context.drawImage(job.bitmap, 0, 0, job.width, job.height);
    const alpha =
      job.detectAlpha && hasTransparency(context.getImageData(0, 0, job.width, job.height).data);
    let blob: Blob;
    if (alpha) {
      blob = await canvas.convertToBlob({ type: "image/png" });
    } else {
      blob = await canvas.convertToBlob({ type: "image/webp", quality: ENCODE_QUALITY });
      // WebKit has no WebP encoder and answers with PNG.
      if (blob.type !== "image/webp") {
        blob = await canvas.convertToBlob({ type: "image/jpeg", quality: ENCODE_QUALITY });
      }
    }
    const bytes = await blob.arrayBuffer();
    workerScope.postMessage({ id: job.id, ok: true, bytes, mime: blob.type, thumbnailUrl }, [bytes]);
  } catch (error) {
    workerScope.postMessage({
      id: job.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    job.bitmap.close();
  }
}

workerScope.onmessage = (event: MessageEvent<ImageJobMessage>) => {
  void handle(event.data);
};
