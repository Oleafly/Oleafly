const LATEX_HREF = /\\href\s*(?:\[[^\]]*\]\s*)?\{([^{}]*)\}(?:\s*\{[^{}]*\})?/gu;
const TYPST_LINK = /#?link\(\s*"((?:[^"\\]|\\.)*)"\s*\)(?:\[[^\]]*\])?/gu;
const MARKDOWN_LINK = /!?\[[^\]\n]*\]\(\s*(<[^<>\n]*>|[^()\s]+)(?:\s[^)\n]*)?\)/gu;

function targetAt(pattern: RegExp, text: string, offset: number, clean: (raw: string) => string): string | null {
  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0;
    if (offset >= start && offset <= start + match[0].length) {
      const target = clean(match[1] ?? "").trim();
      return target || null;
    }
  }
  return null;
}

export function linkTargetAt(text: string, offset: number): string | null {
  return (
    targetAt(LATEX_HREF, text, offset, (raw) => raw.replaceAll(/\\([%#&_~$])/gu, "$1")) ??
    targetAt(TYPST_LINK, text, offset, (raw) => raw.replaceAll(/\\(.)/gu, "$1")) ??
    targetAt(MARKDOWN_LINK, text, offset, (raw) => (raw.startsWith("<") ? raw.slice(1, -1) : raw))
  );
}
