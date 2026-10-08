export type CiteFormat = "latex" | "typst" | "markdown";

export interface CiteSite {
  readonly kind: "prose" | "argument";
  readonly from: number;
  readonly to: number;
  readonly query: string;
  readonly bracketed: boolean;
  readonly separator: string;
}

export interface CiteInsertOptions {
  readonly latexCommand: string;
  readonly markdownBare: boolean;
}

const WINDOW = 600;
const LATEX_ARGUMENT = /\\([A-Za-z]*cite[A-Za-z]*)\*?\s*(?:\[[^\]\n]*\]\s*){0,2}\{([^{}]*)$/i;
const LATEX_PROSE = /(?:^|[\s([{~,;])@((?:[\p{L}\p{M}\p{N}_:.\-+/']+(?: [\p{L}\p{M}\p{N}_:.\-+/']+){0,5} ?)?)$/u;
const TYPST_ANGLE = /#cite\s*\(\s*<([\p{L}\p{M}\p{N}_:.\-+/]*)$/u;
const TYPST_STRING = /#cite\s*\(\s*label\s*\(\s*"([^"\n]*)$/u;
const TYPST_PROSE = /(?:^|[\s[(;,])@((?:[\p{L}\p{M}\p{N}_:.\-+/']+(?: [\p{L}\p{M}\p{N}_:.\-+/']+){0,5} ?)?)$/u;
const MARKDOWN_PROSE = /(?:^|[\s[(;,])@((?:[\p{L}\p{M}\p{N}_:.#$%&\-+?<>~/']+(?: [\p{L}\p{M}\p{N}_:.#$%&\-+?<>~/']+){0,5} ?)?)$/u;
const TYPST_LABEL = /^[\p{L}\p{N}_](?:[\p{L}\p{N}_\-:.]*[\p{L}\p{N}_])?$/u;
const PANDOC_KEY = /^[\p{L}\p{N}_](?:[\p{L}\p{N}_:.#$%&\-+?<>~/]*[\p{L}\p{N}_])?$/u;
const NON_CITING = /author|year|title|url|date|field|list|name|full|alias|^nocite$/i;
const LATEX_KEY_TAIL = /^[^,{}\s%\\]*/;
const TYPST_KEY_TAIL = /^[\p{L}\p{M}\p{N}_:.\-+/']*/u;
const MARKDOWN_KEY_TAIL = /^[\p{L}\p{M}\p{N}_:.#$%&\-+?<>~/']*/u;
const KEY_BODY = /^.*[\p{L}\p{M}\p{N}_]/u;
const MARKDOWN_CITATION = String.raw`(?:^|[^\p{L}\p{N}_\\])@[\p{L}\p{N}_{]`;
const MARKDOWN_CITATION_AT = new RegExp(MARKDOWN_CITATION, "u");

function lineBefore(before: string): string {
  return before.slice(before.lastIndexOf("\n") + 1);
}

function inLatexComment(before: string): boolean {
  return /(?:^|[^\\])(?:\\\\)*%/.test(lineBefore(before));
}

function latexArgument(before: string): string | null {
  const match = LATEX_ARGUMENT.exec(before);
  if (!match || match[2].includes("\n\n")) return null;
  return match[2];
}

function latexSeparator(argument: string): string {
  return !argument.includes(", ") && argument.includes(",") ? "," : ", ";
}

function latexArgumentSite(before: string, pos: number): CiteSite | null {
  const argument = latexArgument(before);
  if (argument === null) return null;
  const segment = argument.slice(argument.lastIndexOf(",") + 1);
  const at = segment.lastIndexOf("@");
  if (at >= 0) {
    const query = segment.slice(at + 1);
    if (/(?:^\s)|[\n,]|\s\s/.test(query) || query.trim().split(" ").length > 6) return null;
    const prefix = segment.slice(0, at);
    if (prefix.trim() === "") {
      return { kind: "argument", from: pos - query.length - 1, to: pos, query, bracketed: false, separator: "" };
    }
    const trailing = prefix.length - prefix.trimEnd().length;
    return {
      kind: "argument",
      from: pos - query.length - 1 - trailing,
      to: pos,
      query,
      bracketed: false,
      separator: latexSeparator(argument),
    };
  }
  const query = segment.trimStart();
  if (/\s/.test(query)) return null;
  return { kind: "argument", from: pos - query.length, to: pos, query, bracketed: false, separator: "" };
}

function proseSite(pattern: RegExp, before: string, pos: number): CiteSite | null {
  const match = pattern.exec(before);
  if (!match) return null;
  const query = match[1] ?? "";
  return { kind: "prose", from: pos - query.length - 1, to: pos, query, bracketed: false, separator: "" };
}

function markdownBracketed(line: string): boolean {
  return line.lastIndexOf("[") > line.lastIndexOf("]");
}

export function citeSiteAt(text: string, pos: number, format: CiteFormat): CiteSite | null {
  const before = text.slice(Math.max(0, pos - WINDOW), pos);
  if (format === "latex") {
    if (inLatexComment(before)) return null;
    return latexArgumentSite(before, pos) ?? proseSite(LATEX_PROSE, before, pos);
  }
  if (format === "typst") {
    const angle = TYPST_ANGLE.exec(before) ?? TYPST_STRING.exec(before);
    if (angle) {
      const query = angle[1] ?? "";
      return { kind: "argument", from: pos - query.length, to: pos, query, bracketed: false, separator: "" };
    }
    return proseSite(TYPST_PROSE, before, pos);
  }
  const site = proseSite(MARKDOWN_PROSE, before, pos);
  if (!site) return null;
  const line = lineBefore(before);
  return { ...site, bracketed: markdownBracketed(line.slice(0, line.length - site.query.length - 1)) };
}

export function caretCiteSite(from: number, to: number): CiteSite {
  return { kind: "prose", from, to, query: "", bracketed: false, separator: "" };
}

function keyEnd(text: string, pos: number, format: CiteFormat): number {
  const after = text.slice(pos, pos + WINDOW);
  if (format === "latex") return pos + (LATEX_KEY_TAIL.exec(after)?.[0].length ?? 0);
  const tail = (format === "typst" ? TYPST_KEY_TAIL : MARKDOWN_KEY_TAIL).exec(after)?.[0] ?? "";
  return pos + (KEY_BODY.exec(tail)?.[0].length ?? 0);
}

function latexListSite(text: string, pos: number): CiteSite {
  const argument = latexArgument(text.slice(Math.max(0, pos - WINDOW), pos)) ?? "";
  const rest = /^[^{}]*/.exec(text.slice(pos, pos + WINDOW))?.[0] ?? "";
  return { kind: "argument", from: pos, to: pos, query: "", bracketed: false, separator: latexSeparator(argument + rest) };
}

function typstAfterCite(text: string, pos: number): CiteSite | null {
  const rest = text.slice(pos, pos + WINDOW);
  const close = rest.search(/[)\n]/);
  if (close < 0 || rest[close] !== ")") return null;
  return { kind: "prose", from: pos + close + 1, to: pos + close + 1, query: "", bracketed: false, separator: " " };
}

function markdownGroupSite(text: string, pos: number): CiteSite | null {
  const line = lineBefore(text.slice(Math.max(0, pos - WINDOW), pos));
  if (!markdownBracketed(line)) return null;
  const group = line.slice(line.lastIndexOf("[") + 1);
  if (!MARKDOWN_CITATION_AT.test(group)) return null;
  const segment = group.slice(group.lastIndexOf(";") + 1);
  return { kind: "prose", from: pos, to: pos, query: "", bracketed: true, separator: segment.trim() ? "; " : "" };
}

export function citeSiteAtCaret(text: string, from: number, to: number, format: CiteFormat): CiteSite {
  const caret = caretCiteSite(from, to);
  const end = keyEnd(text, to, format);
  const site = citeSiteAt(text, end, format);
  if (site?.query === "") return site.kind === "argument" || from === to ? site : caret;
  if (site?.kind === "argument") return format === "latex" ? latexListSite(text, end) : (typstAfterCite(text, end) ?? caret);
  if (site && format !== "latex" && !/\s/.test(site.query)) {
    return { kind: "prose", from: end, to: end, query: "", bracketed: site.bracketed, separator: site.bracketed ? "; " : " " };
  }
  if (format === "markdown") return markdownGroupSite(text, end) ?? caret;
  return caret;
}

export function joinsCitation(site: CiteSite, from: number, to: number): boolean {
  return site.kind === "argument" || site.separator !== "" || site.from !== from || site.to !== to;
}

export function typstLabelSafe(key: string): boolean {
  return TYPST_LABEL.test(key);
}

function pandocKey(key: string): string {
  return PANDOC_KEY.test(key) ? `@${key}` : `@{${key}}`;
}

export function citationInsert(
  format: CiteFormat,
  site: CiteSite,
  key: string,
  options: CiteInsertOptions,
): string {
  if (site.kind === "argument") return `${site.separator}${key}`;
  return `${site.separator}${proseCitation(format, site, key, options)}`;
}

function proseCitation(format: CiteFormat, site: CiteSite, key: string, options: CiteInsertOptions): string {
  if (format === "latex") return `\\${options.latexCommand}{${key}}`;
  if (format === "typst") return typstLabelSafe(key) ? `@${key}` : `#cite(label(${JSON.stringify(key)}))`;
  if (site.bracketed || options.markdownBare) return pandocKey(key);
  return `[${pandocKey(key)}]`;
}

function maskComments(source: string): string {
  return source.replace(/(^|[^\\])%[^\n]*/g, "$1");
}

export function dominantLatexCommand(sources: readonly string[]): string {
  const counts = new Map<string, number>();
  const pattern = /\\([A-Za-z]*cite[A-Za-z]*)\*?\s*(?:\[[^\]\n]*\]\s*){0,2}\{/g;
  for (const source of sources) {
    for (const match of maskComments(source).matchAll(pattern)) {
      const command = match[1];
      if (NON_CITING.test(command)) continue;
      counts.set(command, (counts.get(command) ?? 0) + 1);
    }
  }
  let best = "cite";
  let bestCount = 0;
  for (const [command, count] of counts) {
    if (count > bestCount) {
      best = command;
      bestCount = count;
    }
  }
  return best;
}

export function prefersBareMarkdown(source: string): boolean {
  const citation = new RegExp(MARKDOWN_CITATION, "gu");
  const total = (source.match(citation) ?? []).length;
  let bracketed = 0;
  for (const group of source.matchAll(/\[[^[\]\n]*\]/g)) {
    bracketed += (group[0].match(citation) ?? []).length;
  }
  const bare = total - bracketed;
  return bare > 0 && bare > bracketed;
}
