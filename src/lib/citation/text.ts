export function decodeXmlEntities(s: string): string {
  return s
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}

export function escapeLatex(s: string): string {
  return s.replace(/[\\&%$#_{}~^]/g, (c) => {
    switch (c) {
      case "\\":
        return String.raw`\textbackslash{}`;
      case "~":
        return String.raw`\textasciitilde{}`;
      case "^":
        return String.raw`\textasciicircum{}`;
      default:
        return `\\${c}`;
    }
  });
}

export function cleanField(s: string): string {
  return escapeLatex(decodeXmlEntities(s));
}

export function stripTags(s: string): string {
  let prev: string;
  do {
    prev = s;
    s = s.replace(/<[^>]+>/g, "");
  } while (s !== prev);
  return s;
}

export function toBibName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.includes(",")) return trimmed;
  const parts = trimmed.split(/\s+/);
  if (parts.length < 2) return trimmed;
  const family = parts.pop();
  return `${family}, ${parts.join(" ")}`;
}
