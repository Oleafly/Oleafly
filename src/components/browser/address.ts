export const FALLBACK_SEARCH_URL = "https://duckduckgo.com/?q=";

const SCHEME = /^[a-z][a-z\d+.-]*:/iu;
const HOST_WITH_PORT = /^[a-z\d.-]+:\d{1,5}(?:[/?#].*)?$/iu;
const BARE_HOST =
  /^(?:localhost|(?:\d{1,3}\.){3}\d{1,3}|[a-z\d-]+(?:\.[a-z\d-]+)+)(?::\d{1,5})?(?:[/?#].*)?$/iu;

function webUrlOrNull(candidate: string): string | null {
  try {
    const url = new URL(candidate);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (!url.hostname) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function resolveAddressInput(
  raw: string,
  searchUrl: string = FALLBACK_SEARCH_URL,
): string | null {
  const text = raw.trim();
  if (!text) return null;
  const search = () => `${searchUrl}${encodeURIComponent(text)}`;
  if (/\s/u.test(text)) return search();
  if (SCHEME.test(text)) {
    const direct = webUrlOrNull(text);
    if (direct) return direct;
    if (HOST_WITH_PORT.test(text)) return webUrlOrNull(`https://${text}`) ?? search();
    return search();
  }
  if (BARE_HOST.test(text)) return webUrlOrNull(`https://${text}`) ?? search();
  return search();
}

export function displayHost(url: string): string {
  try {
    const host = new URL(url).hostname;
    return host.startsWith("www.") ? host.slice(4) : host;
  } catch {
    return "";
  }
}

export function tabText(tab: { url: string; title: string }): string {
  const title = tab.title.trim();
  if (title) return title;
  return displayHost(tab.url) || tab.url || "New tab";
}
