const NEEDS_ANGLE_BRACKETS = /[\s()<>]|[^\x21-\x7e]/u;
const URL_SCHEME = /^[a-z][a-z0-9+.-]*:/iu;
const BACKSLASH_BEFORE_MATCH = String.raw`\$&`;

export function markdownLinkDestination(path: string): string {
  if (path !== "" && !NEEDS_ANGLE_BRACKETS.test(path)) return path.replaceAll("\\", "\\\\");
  return `<${path.replaceAll(/[\\<>]/gu, BACKSLASH_BEFORE_MATCH)}>`;
}

export function isUrlWithScheme(href: string): boolean {
  return URL_SCHEME.test(href) || href.startsWith("//");
}

export function linkHrefForPath(path: string, fragment = ""): string {
  return `${encodeURI(path).replaceAll("#", "%23").replaceAll("?", "%3F")}${encodeURI(fragment)}`;
}

export function readableLinkHref(href: string): string {
  if (isUrlWithScheme(href)) return href;
  try {
    return decodeURI(href);
  } catch {
    return href;
  }
}
