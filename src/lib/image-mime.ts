// Shared image extension/MIME helpers. data: URLs are used app-wide because
// the CSP only allows img-src data:.

interface ImageFormat {
  readonly extension: string;
  readonly mime: string;
  readonly preview: boolean;
  readonly latex: boolean;
  readonly insert: boolean;
}

const IMAGE_FORMATS: readonly ImageFormat[] = [
  { extension: "png", mime: "image/png", preview: true, latex: true, insert: true },
  { extension: "jpg", mime: "image/jpeg", preview: true, latex: true, insert: true },
  { extension: "jpeg", mime: "image/jpeg", preview: true, latex: true, insert: true },
  { extension: "gif", mime: "image/gif", preview: true, latex: false, insert: false },
  { extension: "webp", mime: "image/webp", preview: true, latex: false, insert: false },
  { extension: "bmp", mime: "image/bmp", preview: true, latex: false, insert: false },
  { extension: "svg", mime: "image/svg+xml", preview: true, latex: true, insert: true },
  { extension: "pdf", mime: "application/pdf", preview: false, latex: true, insert: true },
  { extension: "eps", mime: "application/postscript", preview: false, latex: true, insert: false },
];

function formatOf(path: string): ImageFormat | undefined {
  const dot = path.lastIndexOf(".");
  if (dot < 0) return undefined;
  const extension = path.slice(dot + 1).toLowerCase();
  return IMAGE_FORMATS.find((format) => format.extension === extension);
}

export const INSERTABLE_IMAGE_EXTENSIONS: string[] = IMAGE_FORMATS.filter((format) => format.insert).map(
  (format) => format.extension,
);

export function isImagePath(path: string, { allowPdf = false }: { allowPdf?: boolean } = {}): boolean {
  const format = formatOf(path);
  if (!format) return false;
  return format.preview || (allowPdf && format.extension === "pdf");
}

export function isLatexGraphicsPath(path: string): boolean {
  return formatOf(path)?.latex ?? false;
}

export function isInsertableImagePath(path: string): boolean {
  return formatOf(path)?.insert ?? false;
}

export function insertableImageExtension(mime: string): string | undefined {
  return IMAGE_FORMATS.find((format) => format.insert && format.mime === mime)?.extension;
}

export function imageMime(path: string): string {
  const format = formatOf(path);
  return format?.preview ? format.mime : "image/png";
}
