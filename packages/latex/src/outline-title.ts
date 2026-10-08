import {
  latexWrapperSections,
  scanLatexDefinitions,
  type LatexDefinitions,
  type LatexWrapperSection,
} from "./latex-definitions";
import { decodeLatexAccents } from "./tex-text";

const SIMPLE_TEXT_COMMANDS =
  /\\(?:emph|footnotesize|[Hh]uge|LARGE|[Ll]arge|MakeLowercase|MakeTextLowercase|MakeTextUppercase|MakeUppercase|bm|boldsymbol|mathbf|mathit|mathrm|mathsf|mbox|pmb|scriptsize|small|text|textbf|textit|textmd|textnormal|textrm|textsc|textsf|textsl|texttt|textup|tiny|uline|underline)\s*\{([^{}]*)\}/gu;
const COLOURED_TEXT = /\\(?:colorbox|textcolor)\s*(?:\[[^\]]*\]\s*)?\{[^{}]*\}\s*\{([^{}]*)\}/gu;
const COLOUR_SWITCH = /\\color\s*(?:\[[^\]]*\]\s*)?\{[^{}]*\}/gu;
const FONT_SWITCHES =
  /\\(?:bfseries|em|footnotesize|[Hh]uge|itshape|LARGE|[Ll]arge|mdseries|normalfont|normalsize|rmfamily|scriptsize|scshape|selectfont|sffamily|slshape|small|tiny|ttfamily|upshape)(?![\p{L}@])\s*/gu;
const NAME_REFERENCE = /\\[nN]ameref\*?\s*\{([^{}]*)\}/gu;
const MATH_DELIMITERS = /(?<!\\)\$|\\[()]/gu;
const PLAIN_GROUP = /(?<!\\[\p{L}@]+\*?\s*|\]\s*|\\)\{([^{}\\]*)\}/gu;

function maskComments(text: string): string {
  return text
    .split("\n")
    .map((line) => {
      for (let index = 0; index < line.length; index += 1) {
        if (line[index] !== "%") continue;
        let slashes = 0;
        for (
          let cursor = index - 1;
          cursor >= 0 && line[cursor] === "\\";
          cursor -= 1
        ) {
          slashes += 1;
        }
        if (slashes % 2 === 0) {
          return `${line.slice(0, index)}${" ".repeat(line.length - index)}`;
        }
      }
      return line;
    })
    .join("\n");
}

function matchingBrace(text: string, open: number): number {
  let depth = 0;
  for (let index = open; index < text.length; index += 1) {
    if (text[index] === "\\") {
      index += 1;
      continue;
    }
    if (text[index] === "{") depth += 1;
    if (text[index] !== "}") continue;
    depth -= 1;
    if (depth === 0) return index;
  }
  return -1;
}

function collectNewCommands(text: string, macros: Map<string, string>): void {
  const command =
    /\\(?:newcommand|renewcommand|providecommand)\*?\s*(?:\{\s*)?\\([\p{L}\p{M}@]+)\s*(?:\}\s*)?(?:\[(\d+)\]\s*)?\{/gu;
  for (let match = command.exec(text); match; match = command.exec(text)) {
    if (match[2] && match[2] !== "0") continue;
    const open = command.lastIndex - 1;
    const close = matchingBrace(text, open);
    if (close < 0) continue;
    macros.set(match[1], text.slice(open + 1, close));
    command.lastIndex = close + 1;
  }
}

function collectDefinitions(text: string, macros: Map<string, string>): void {
  const definition = /\\def\s*\\([\p{L}\p{M}@]+)\s*\{/gu;
  for (
    let match = definition.exec(text);
    match;
    match = definition.exec(text)
  ) {
    const open = definition.lastIndex - 1;
    const close = matchingBrace(text, open);
    if (close < 0) continue;
    macros.set(match[1], text.slice(open + 1, close));
    definition.lastIndex = close + 1;
  }
}

const LATEX_MACRO_SOURCE = /\.(?:cls|latex|ltx|sty|tex)$/iu;

function collectFileMacros(source: string, macros: Map<string, string>): void {
  const text = maskComments(source);
  collectNewCommands(text, macros);
  collectDefinitions(text, macros);
}

export function collectLatexOutlineMacros(
  files: Readonly<Record<string, string>>,
): ReadonlyMap<string, string> {
  const macros = new Map<string, string>();
  for (const [path, source] of Object.entries(files)) {
    if (!LATEX_MACRO_SOURCE.test(path)) continue;
    collectFileMacros(source, macros);
  }
  return macros;
}

type FileMacros = Readonly<{
  source: string;
  macros: ReadonlyMap<string, string>;
}>;

export function createLatexOutlineMacroCollector(): (
  files: Readonly<Record<string, string>>,
) => ReadonlyMap<string, string> {
  let cache = new Map<string, FileMacros>();
  return (files) => {
    const next = new Map<string, FileMacros>();
    const macros = new Map<string, string>();
    for (const [path, source] of Object.entries(files)) {
      if (!LATEX_MACRO_SOURCE.test(path)) continue;
      let entry = cache.get(path);
      if (entry?.source !== source) {
        const fileMacros = new Map<string, string>();
        collectFileMacros(source, fileMacros);
        entry = { source, macros: fileMacros };
      }
      next.set(path, entry);
      for (const [name, body] of entry.macros) macros.set(name, body);
    }
    cache = next;
    return macros;
  };
}

const LATEX_DOCUMENT_SOURCE = /\.(?:latex|ltx|tex)$/iu;

type FileDefinitions = Readonly<{ source: string; masked: string; definitions: LatexDefinitions }>;
type FileWrapperSections = Readonly<{ source: string; key: string; sections: readonly LatexWrapperSection[] }>;

export function createLatexWrapperSectionCollector(): (
  files: Readonly<Record<string, string>>,
) => ReadonlyMap<string, readonly LatexWrapperSection[]> {
  let definitionCache = new Map<string, FileDefinitions>();
  let sectionCache = new Map<string, FileWrapperSections>();
  return (files) => {
    const nextDefinitions = new Map<string, FileDefinitions>();
    for (const [path, source] of Object.entries(files)) {
      if (!LATEX_MACRO_SOURCE.test(path)) continue;
      let entry = definitionCache.get(path);
      if (entry?.source !== source) {
        const masked = maskComments(source);
        entry = { source, masked, definitions: scanLatexDefinitions(masked) };
      }
      nextDefinitions.set(path, entry);
    }
    definitionCache = nextDefinitions;
    const wrappers = [...nextDefinitions.values()].flatMap((entry) => entry.definitions.wrappers);
    const key = JSON.stringify(wrappers);
    const nextSections = new Map<string, FileWrapperSections>();
    const result = new Map<string, readonly LatexWrapperSection[]>();
    for (const [path, entry] of nextDefinitions) {
      if (!LATEX_DOCUMENT_SOURCE.test(path)) continue;
      let sections = sectionCache.get(path);
      if (sections?.source !== entry.source || sections.key !== key) {
        sections = {
          source: entry.source,
          key,
          sections: latexWrapperSections(entry.masked, wrappers, entry.definitions.spans),
        };
      }
      nextSections.set(path, sections);
      if (sections.sections.length > 0) result.set(path, sections.sections);
    }
    sectionCache = nextSections;
    return result;
  };
}

function expandProjectMacros(
  source: string,
  macros: ReadonlyMap<string, string>,
): string {
  let result = source;
  for (let depth = 0; depth < 8; depth += 1) {
    let changed = false;
    result = result.replace(
      /\\([\p{L}\p{M}@]+)(?:\s*\{\s*\})?/gu,
      (whole, name: string) => {
        const replacement = macros.get(name);
        if (replacement === undefined) return whole;
        changed = true;
        return replacement;
      },
    );
    if (!changed) break;
  }
  return result;
}

export function renderLatexOutlineTitle(
  source: string,
  macros: ReadonlyMap<string, string> = new Map(),
  headingsByLabel: ReadonlyMap<string, string> = new Map(),
): string {
  const named = source.replace(NAME_REFERENCE, (_whole, label: string) => headingsByLabel.get(label.trim()) ?? label.trim());
  let result = decodeLatexAccents(expandProjectMacros(named, macros)).replace(MATH_DELIMITERS, "");
  let previous = "";
  while (result !== previous) {
    previous = result;
    result = result.replace(SIMPLE_TEXT_COMMANDS, "$1").replace(COLOURED_TEXT, "$1");
  }
  result = result
    .replace(COLOUR_SWITCH, "")
    .replace(/\{\\(?:bf|it|rm|sf|tt)\s+([^\s{}][^{}]*|)\}/gu, "$1")
    .replace(FONT_SWITCHES, "");
  previous = "";
  while (result !== previous) {
    previous = result;
    result = result.replace(PLAIN_GROUP, "$1");
  }
  return result
    .replace(/\\LaTeX(?:\s*\{\s*\})?/gu, "LaTeX")
    .replace(/\\TeX(?:\s*\{\s*\})?/gu, "TeX")
    .replace(/\\textasciitilde\s*\{\s*\}/gu, "~")
    .replace(/\\textasciicircum\s*\{\s*\}/gu, "^")
    .replace(/\\textbackslash\s*\{\s*\}/gu, "\\")
    .replace(/\\(?:centering|protect|relax|xspace)\b/gu, "")
    .replace(/\\(?:,|;|:|!|\s)/gu, " ")
    .replace(/\\pm\b/gu, "±")
    .replace(/\\times\b/gu, "×")
    .replace(/\\to\b/gu, "→")
    .replace(/\\([%$&#_{}])/gu, "$1")
    .replace(/\{\s*\}/gu, "")
    .replaceAll("~", " ")
    .replace(/``|''/gu, '"')
    .replace(/\s+/gu, " ")
    .trim();
}
