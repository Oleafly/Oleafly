// Reading an image for the Tools and fitting it to where it goes. A local
// Ollama model gets the original bytes, unless a PNG can be transparent: that
// one is drawn onto white first, as for every model. Hosted models get at most 2,000 px
// and 3.75 MB (base64 stays under the 5 MB every hosted API accepts), and
// Mathpix gets PNG or JPEG under 1.45 MB (its base64 limit is 2 MB).
import { i18n } from "@/i18n";
import { base64ToBytes, bytesToBase64 } from "@/lib/base64";
import { downscaleImage, type Downscaler } from "./image-downscale";
import { pngMayHaveAlpha } from "./image-downscale-core";

export type ToolImageMime = "image/png" | "image/jpeg" | "image/webp";

export interface ImageInput {
  bytes: Uint8Array;
  mime: ToolImageMime;
}

export const MAX_TOOL_IMAGE_BYTES = 20 * 1024 * 1024;

export interface ImageBudget {
  /** Longest edge in pixels; null keeps the size. */
  maxEdge: number | null;
  maxBytes: number;
  accept: readonly ToolImageMime[];
}

const ANY_FORMAT: readonly ToolImageMime[] = ["image/png", "image/jpeg", "image/webp"];

export const IMAGE_BUDGETS: {
  readonly local: ImageBudget;
  readonly hosted: ImageBudget;
  readonly mathpix: ImageBudget;
} = {
  local: { maxEdge: null, maxBytes: MAX_TOOL_IMAGE_BYTES, accept: ANY_FORMAT },
  hosted: { maxEdge: 2_000, maxBytes: 3_750_000, accept: ANY_FORMAT },
  mathpix: { maxEdge: 2_000, maxBytes: 1_450_000, accept: ["image/png", "image/jpeg"] },
};

export interface PreparedImage {
  mime: ToolImageMime;
  base64: string;
  dataUrl: string;
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCodePoint(...bytes.subarray(start, end));
}

/** The image format by its first bytes, never by its name. */
export function sniffImageMime(bytes: Uint8Array): ToolImageMime | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") {
    return "image/webp";
  }
  return null;
}

function imageFormatError(): Error {
  return new Error(i18n.t(($) => $.researchTools.converterErrors.imageFormat));
}

async function readChosenFile(file: File): Promise<Uint8Array> {
  if (file.size > MAX_TOOL_IMAGE_BYTES) {
    throw new Error(i18n.t(($) => $.researchTools.converterErrors.chooseSmallerImage));
  }
  return new Uint8Array(await file.arrayBuffer());
}

/** Reads a chosen image. Over 20 MB is refused before anything is read. */
export async function readImageInput(file: File): Promise<ImageInput> {
  const bytes = await readChosenFile(file);
  const mime = sniffImageMime(bytes);
  if (!mime) throw imageFormatError();
  return { bytes, mime };
}

const AS_PNG: ImageBudget = { maxEdge: null, maxBytes: MAX_TOOL_IMAGE_BYTES, accept: ["image/png"] };

/** Reads an image chosen in the editor, which takes any image the system can
 * draw, as it did before the Tools model: a GIF, BMP or HEIC becomes a PNG
 * here. The converters keep to PNG, JPEG and WebP. */
export async function readEditorImageInput(
  file: File,
  convert: Downscaler = downscaleImage,
): Promise<ImageInput> {
  const bytes = await readChosenFile(file);
  const mime = sniffImageMime(bytes);
  if (mime) return { bytes, mime };
  // A file named as PNG, JPEG or WebP that is none of them is refused.
  if (!file.type.startsWith("image/") || ANY_FORMAT.includes(file.type as ToolImageMime)) {
    throw imageFormatError();
  }
  // Only the decoder reads this type, and it is never PNG, so the image is
  // always drawn again as a PNG.
  return convert({ bytes, mime: file.type as ToolImageMime }, AS_PNG);
}

/** A rendered PDF page (a PNG data URL) as image input. */
export function dataUrlToImageInput(dataUrl: string): ImageInput {
  const comma = dataUrl.indexOf(",");
  const bytes = base64ToBytes(comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl);
  const mime = sniffImageMime(bytes);
  if (!mime) throw imageFormatError();
  return { bytes, mime };
}

/** The image as the destination accepts it, base64 and as a data URL. */
export async function prepareImage(
  input: ImageInput,
  budget: ImageBudget,
  downscale: Downscaler = downscaleImage,
): Promise<PreparedImage> {
  const fits =
    budget.maxEdge === null
    && budget.accept.includes(input.mime)
    && input.bytes.byteLength <= budget.maxBytes
    && !(input.mime === "image/png" && pngMayHaveAlpha(input.bytes));
  // Hosted images always pass through the downscaler. It re-encodes JPEG and
  // WebP photos, which applies their EXIF orientation and drops the rest of
  // their EXIF data, location included.
  const image = fits ? input : await downscale(input, budget);
  const base64 = bytesToBase64(image.bytes);
  return { mime: image.mime, base64, dataUrl: `data:${image.mime};base64,${base64}` };
}
