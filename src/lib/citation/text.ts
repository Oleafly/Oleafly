export function decodeXmlEntities(s: string): string {
  return s
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&apos;", "'")
    // Decode &amp; last so &amp;lt; -> &lt; (not <).
    .replaceAll("&amp;", "&");
}

// So remote metadata compiles as literal text rather than LaTeX commands.
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

// Strips markup tags to a fixed point (not a single pass) so a malformed or
// nested tag like "<<script>script>" can't reconstitute into "<script>"
// after one round of removal.
export function stripTags(s: string): string {
  let prev: string;
  do {
    prev = s;
    s = s.replace(/<[^>]+>/g, "");
  } while (s !== prev);
  return s;
}

// "Jane Smith" -> "Smith, Jane"; already-comma'd names pass through.
export function toBibName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.includes(",")) return trimmed;
  const parts = trimmed.split(/\s+/);
  if (parts.length < 2) return trimmed;
  const family = parts.pop();
  return `${family}, ${parts.join(" ")}`;
}
