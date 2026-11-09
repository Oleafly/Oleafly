const ABSOLUTE_URL = /^[a-z][a-z\d+.-]*:/iu;

export function imageSource(src: string): { url: string } | { path: string } | null {
  const value = src.trim();
  if (value === "") return null;
  if (/^(?:https:|data:image\/)/iu.test(value)) return { url: value };
  if (ABSOLUTE_URL.test(value) || value.startsWith("/") || value.startsWith("\\")) return null;
  let path = value;
  try {
    path = decodeURI(value);
  } catch {
    path = value;
  }
  const clean = path.replace(/^\.\//u, "");
  return clean.split(/[\\/]/u).includes("..") ? null : { path: clean };
}

export function notePath(src: string): string | null {
  const source = imageSource(src);
  return source && "path" in source ? source.path : null;
}
