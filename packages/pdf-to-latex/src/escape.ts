const MAP: Record<string, string> = {
  "\\": String.raw`\textbackslash{}`,
  "%": String.raw`\%`,
  $: String.raw`\$`,
  "&": String.raw`\&`,
  "#": String.raw`\#`,
  _: String.raw`\_`,
  "{": String.raw`\{`,
  "}": String.raw`\}`,
  "~": String.raw`\textasciitilde{}`,
  "^": String.raw`\textasciicircum{}`,
};

export function escapeLatex(s: string): string {
  return s.replace(/[\\%$&#_{}~^]/g, (c) => MAP[c]);
}

/** Matches a url whose specials have already been escaped by escapeLatex. */
const ESCAPED_URL_RE =
  /https?:\/\/(?:\\[%$&#_{}]|\\textasciitilde\{\}|\\textasciicircum\{\}|[^\s\\}]|\\(?=[%$&#_{}]))+/g;

function unescapeLatex(s: string): string {
  return s
    .replaceAll(String.raw`\textasciitilde{}`, "~")
    .replaceAll(String.raw`\textasciicircum{}`, "^")
    .replaceAll(String.raw`\textbackslash{}`, "\\")
    .replace(/\\([%$&#_{}])/g, "$1");
}

export function restoreUrlsInTex(tex: string): string {
  return tex.replace(ESCAPED_URL_RE, (m) => String.raw`\url{${unescapeLatex(m)}}`);
}
