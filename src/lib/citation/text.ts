export function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    // Decode &amp; last so &amp;lt; -> &lt; (not <).
    .replace(/&amp;/g, "&");
}

// So remote metadata compiles as literal text rather than LaTeX commands.
export function escapeLatex(s: string): string {
  return s.replace(/[\\&%$#_{}~^]/g, (c) => {
    switch (c) {
      case "\\":
        return "\\textbackslash{}";
      case "~":
        return "\\textasciitilde{}";
      case "^":
        return "\\textasciicircum{}";
      default:
        return `\\${c}`;
    }
  });
}

export function cleanField(s: string): string {
  return escapeLatex(decodeXmlEntities(s));
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
