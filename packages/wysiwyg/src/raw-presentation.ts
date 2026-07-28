const BLOCK_LABELS: Record<string, string> = {
  abstract: "Abstract",
  author: "Authors",
  bibliography: "Bibliography",
  bibliographystyle: "Bibliography style",
  date: "Date",
  figure: "Figure",
  "figure*": "Figure",
  IEEEkeywords: "Keywords",
  keywords: "Keywords",
  maketitle: "Document title",
  table: "Table",
  "table*": "Table",
  tabular: "Table",
  "tabular*": "Table",
  title: "Title",
};

const PREVIEW_SOURCE_LIMIT = 12_000;
const PREVIEW_TEXT_LIMIT = 360;

function commandName(source: string): string | null {
  return /^\\([A-Za-z@]+\*?)/u.exec(source.trimStart())?.[1] ?? null;
}

function environmentName(source: string): string | null {
  return /^\\begin\{([^}]+)\}/u.exec(source.trimStart())?.[1] ?? null;
}

function stripComments(source: string): string {
  return source
    .split(/\r?\n/u)
    .map((line) => {
      for (let index = 0; index < line.length; index++) {
        if (line[index] !== "%") continue;
        let slashes = 0;
        for (let cursor = index - 1; cursor >= 0 && line[cursor] === "\\"; cursor--) {
          slashes++;
        }
        if (slashes % 2 === 0) return line.slice(0, index);
      }
      return line;
    })
    .join("\n");
}

function readableLatex(source: string): string {
  const escaped: string[] = [];
  const protect = (value: string) => {
    const index = escaped.push(value) - 1;
    return ` OLEAFLYESCAPED${index}X `;
  };
  const text = stripComments(source.slice(0, PREVIEW_SOURCE_LIMIT))
    .replace(/\{\\L\}/gu, "Ł")
    .replace(/\\([%$&#_{}])/gu, (_match, value: string) => protect(value))
    .replace(/\\thanks\s*\{[^{}]*\}/gu, " ")
    .replace(/\\footnotemark(?:\[[^\]]*\])?/gu, " ")
    .replace(/\\L(?![A-Za-z])/gu, "Ł")
    .replace(/\\ /gu, " ")
    .replace(/\\\\/gu, " · ")
    .replace(/\\(?:quad|qquad|enspace|hfill)\b/gu, " ")
    .replace(/\\and\b/gu, " · ")
    .replace(/\\(?:begin|end)\{[^}]+\}/gu, " ")
    .replace(/\\[A-Za-z@]+\*?(?:\s*\[[^\]]*\])?/gu, " ")
    .replace(/[{}]/gu, " ")
    .replace(/~/gu, " ")
    .replace(/OLEAFLYESCAPED(\d+)X/gu, (_match, index: string) => escaped[Number(index)] ?? "")
    .replace(/[{}]/gu, " ")
    .replace(/\\+/gu, " ")
    .replace(/\s*·\s*/gu, " · ")
    .replace(/\s+/gu, " ")
    .trim();

  if (text.length <= PREVIEW_TEXT_LIMIT) return text;
  return `${text.slice(0, PREVIEW_TEXT_LIMIT - 1).trimEnd()}…`;
}

export function rawBlockPresentation(source: string): {
  label: string;
  preview: string;
} {
  const environment = environmentName(source);
  const command = commandName(source);
  const name = environment ?? command ?? "";
  const label =
    BLOCK_LABELS[name] ??
    (source.trimStart().startsWith("%")
      ? "Comment"
      : environment
        ? `${environment} environment`
        : command
          ? `\\${command} command`
          : "LaTeX source");

  if (name === "maketitle") {
    return {
      label,
      preview: "Generated from the document title and author metadata.",
    };
  }

  if (["figure", "figure*", "table", "table*", "tabular", "tabular*"].includes(name)) {
    const caption = /\\caption(?:\[[^\]]*\])?\s*\{([^{}]*)\}/u.exec(source)?.[1];
    return {
      label,
      preview: caption
        ? readableLatex(caption)
        : `Exact ${name.startsWith("figure") ? "figure" : "table"} source preserved.`,
    };
  }

  const preview = readableLatex(source);
  return {
    label,
    preview: preview || "Exact source preserved",
  };
}

export function compactRawInlineSource(source: string): string {
  const normalized = source.replace(/\s+/gu, " ").trim();
  if (
    normalized === "~" ||
    /^\\textasciitilde\s*\{\s*\}$/u.test(normalized)
  ) {
    return "\u00a0";
  }
  if (normalized === "{,}") return ",";

  const escapedCharacter = /^\\([%$&#_{}])$/u.exec(normalized);
  if (escapedCharacter) return escapedCharacter[1];

  const citation =
    /^\\(?:[A-Za-z]*cite[A-Za-z]*|cite)\*?\s*(?:\[[^\]]*\]\s*)*\{\s*([^{}]+?)\s*\}$/u.exec(
      normalized,
    );
  if (citation) {
    return citation[1]
      .split(",")
      .map((key) => `@${key.trim()}`)
      .join(", ");
  }

  const reference =
    /^\\(?:auto|page|eq|name|v|V|c|C)?ref\*?\s*(?:\[[^\]]*\]\s*)?\{\s*([^{}]+?)\s*\}$/u.exec(
      normalized,
    );
  if (reference) return `§ ${reference[1].trim()}`;

  const label = /^\\label\{([^{}]+)\}$/u.exec(normalized);
  if (label) return `#${label[1].trim()}`;

  if (normalized === String.raw`\\`) return "↵";
  if (normalized === String.raw`\hfill`) return "↔";
  if (normalized.length <= 64) return normalized;
  const command = commandName(normalized);
  return command ? `\\${command}…` : `${normalized.slice(0, 61).trimEnd()}…`;
}

export function isRawMathSource(source: string): boolean {
  const trimmed = source.trim();
  return (
    /^\$\$[\s\S]*\$\$$/u.test(trimmed) ||
    /^\$(?:\\.|[^$])+\$$/u.test(trimmed) ||
    /^\\\([\s\S]*\\\)$/u.test(trimmed) ||
    /^\\\[[\s\S]*\\\]$/u.test(trimmed)
  );
}
