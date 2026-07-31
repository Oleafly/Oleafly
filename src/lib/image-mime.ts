// Shared image extension/MIME helpers. data: URLs are used app-wide because
// the CSP only allows img-src data:.

export const IMAGE_EXTS = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg"];

export function imageMime(path: string): string {
  const p = path.toLowerCase();
  if (p.endsWith(".jpg") || p.endsWith(".jpeg")) return "image/jpeg";
  if (p.endsWith(".gif")) return "image/gif";
  if (p.endsWith(".webp")) return "image/webp";
  if (p.endsWith(".bmp")) return "image/bmp";
  if (p.endsWith(".svg")) return "image/svg+xml";
  return "image/png";
}
