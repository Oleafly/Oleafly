import { wysiwygMessage, type WysiwygMessageKey } from "./messages";

const BLOCK_LABEL_KEYS: Record<string, WysiwygMessageKey> = {
  abstract: "block.abstract",
  author: "block.author",
  bibliography: "block.bibliography",
  bibliographystyle: "block.bibliographyStyle",
  date: "block.date",
  figure: "block.figure",
  "figure*": "block.figure",
  IEEEkeywords: "block.keywords",
  keywords: "block.keywords",
  maketitle: "block.documentTitle",
  table: "block.table",
  "table*": "block.table",
  tabular: "block.table",
  "tabular*": "block.table",
  title: "block.title",
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
    .replaceAll(String.raw`{\L}`, "Ł")
    .replace(/\\([%$&#_{}])/gu, (_match, value: string) => protect(value))
    .replace(/\\thanks\s*\{[^{}]*\}/gu, " ")
    .replace(/\\footnotemark(?:\[[^\]]*\])?/gu, " ")
    .replace(/\\L(?![A-Za-z])/gu, "Ł")
    .replaceAll(String.raw`\ `, " ")
    .replaceAll(String.raw`\\`, " · ")
    .replace(/\\(?:quad|qquad|enspace|hfill)\b/gu, " ")
    .replace(/\\and\b/gu, " · ")
    .replace(/\\(?:begin|end)\{[^}]+\}/gu, " ")
    .replace(/\\[A-Za-z@]+\*?(?:\s*\[[^\]]*\])?/gu, " ")
    .replace(/[{}]/gu, " ")
    .replaceAll("~", " ")
    .replace(/OLEAFLYESCAPED(\d+)X/gu, (_match, index: string) => escaped[Number(index)] ?? "")
    .replace(/[{}]/gu, " ")
    .replace(/\\+/gu, " ")
    .replaceAll("·", " · ")
    .replace(/\s+/gu, " ")
    .trim();

  if (text.length <= PREVIEW_TEXT_LIMIT) return text;
  return `${text.slice(0, PREVIEW_TEXT_LIMIT - 1).trimEnd()}…`;
}

function blockLabel(
  source: string,
  environment: string | null,
  command: string | null,
  name: string,
): string {
  const labelKey = BLOCK_LABEL_KEYS[name];
  if (labelKey) return wysiwygMessage(labelKey);
  if (source.trimStart().startsWith("%")) return wysiwygMessage("block.comment");
  if (environment) return wysiwygMessage("block.environment", { environment });
  if (command) return wysiwygMessage("block.command", { command });
  return wysiwygMessage("block.latexSource");
}

export function rawBlockPresentation(source: string): {
  label: string;
  preview: string;
} {
  const environment = environmentName(source);
  const command = commandName(source);
  const name = environment ?? command ?? "";
  const label = blockLabel(source, environment, command, name);

  if (name === "maketitle") {
    return {
      label,
      preview: wysiwygMessage("block.maketitlePreview"),
    };
  }

  if (["figure", "figure*", "table", "table*", "tabular", "tabular*"].includes(name)) {
    const caption = /\\caption(?:\[[^\]]*\])?\s*\{([^{}]*)\}/u.exec(source)?.[1];
    const preserved = name.startsWith("figure")
      ? wysiwygMessage("block.figurePreserved")
      : wysiwygMessage("block.tablePreserved");
    return {
      label,
      preview: caption ? readableLatex(caption) : preserved,
    };
  }

  const preview = readableLatex(source);
  return {
    label,
    preview: preview || wysiwygMessage("block.sourcePreserved"),
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

  const macro = /^\\([A-Za-z]+)\*?\s*(?:\[[^\]]*\]\s*)*\{([^{}]+)\}$/u.exec(normalized);
  if (macro?.[1].includes("cite")) {
    return macro[2]
      .split(",")
      .map((key) => `@${key.trim()}`)
      .join(", ");
  }

  const reference = /^\\(?:auto|page|eq|name|v|V|c|C)?ref\*?\s*(?:\[[^\]]*\]\s*)?\{([^{}]+)\}$/u.exec(
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
  if (
    (trimmed.startsWith("$$") && trimmed.endsWith("$$")) ||
    (trimmed.startsWith(String.raw`\(`) && trimmed.endsWith(String.raw`\)`)) ||
    (trimmed.startsWith(String.raw`\[`) && trimmed.endsWith(String.raw`\]`))
  ) {
    return trimmed.length >= 4;
  }
  if (
    trimmed.length < 3 ||
    !trimmed.startsWith("$") ||
    trimmed.at(-1) !== "$"
  ) {
    return false;
  }
  let hasContent = false;
  for (let cursor = 1; cursor < trimmed.length - 1; cursor += 1) {
    if (trimmed[cursor] === "$") return false;
    if (trimmed[cursor] === "\\") {
      if (cursor + 1 >= trimmed.length - 1) return false;
      cursor += 1;
    }
    hasContent = true;
  }
  return hasContent;
}
