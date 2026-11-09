const APP_HOSTS: ReadonlySet<string> = new Set(["tauri.localhost", "asset.localhost"]);

function pageAddress(): string {
  return typeof window === "undefined" ? "tauri://localhost/" : window.location.href;
}

export function remoteImageHost(src: string, base: string = pageAddress()): string | null {
  const value = src.trim();
  if (value === "" || /^(?:data|blob):/iu.test(value)) return null;
  let url: URL;
  let page: URL;
  try {
    page = new URL(base);
    url = new URL(value, page);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.origin === page.origin || APP_HOSTS.has(url.hostname)) return null;
  return url.host;
}
