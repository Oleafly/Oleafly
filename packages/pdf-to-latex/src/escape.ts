const MAP: Record<string, string> = {
  "\\": "\\textbackslash{}",
  "%": "\\%",
  $: "\\$",
  "&": "\\&",
  "#": "\\#",
  _: "\\_",
  "{": "\\{",
  "}": "\\}",
  "~": "\\textasciitilde{}",
  "^": "\\textasciicircum{}",
};

export function escapeLatex(s: string): string {
  return s.replace(/[\\%$&#_{}~^]/g, (c) => MAP[c]);
}

/** Matches a url whose specials have already been escaped by escapeLatex. */
const ESCAPED_URL_RE =
  /https?:\/\/(?:\\[%$&#_{}]|\\textasciitilde\{\}|\\textasciicircum\{\}|[^\s\\}]|\\(?=[%$&#_{}]))+/g;

function unescapeLatex(s: string): string {
  return s
    .replace(/\\textasciitilde\{\}/g, "~")
    .replace(/\\textasciicircum\{\}/g, "^")
    .replace(/\\textbackslash\{\}/g, "\\")
    .replace(/\\([%$&#_{}])/g, "$1");
}

export function restoreUrlsInTex(tex: string): string {
  return tex.replace(ESCAPED_URL_RE, (m) => `\\url{${unescapeLatex(m)}}`);
}
