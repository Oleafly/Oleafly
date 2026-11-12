import { usepackageLine } from "@/lib/latex-package-index";

export type TikzKind = "tikz" | "circuitikz";

export interface LatexPackage {
  name: string;
  options: string;
}

interface SourceOrigin {
  line: number;
  shared: boolean;
}

interface SourceLine extends SourceOrigin {
  text: string;
}

interface TikzParts {
  whole: boolean;
  preamble: SourceLine[];
  body: SourceLine[];
  wrap: boolean;
}

export interface TikzDocument {
  text: string;
  lines: readonly (SourceOrigin | null)[];
}

interface TikzFigure {
  packages: LatexPackage[];
  lines: string[];
}

const ENVIRONMENT: Readonly<Record<TikzKind, string>> = { tikz: "tikzpicture", circuitikz: "circuitikz" };
const DOCUMENT_CLASS = /^\s*\\documentclass\b/u;
const BEGIN_DOCUMENT = /^\s*\\begin\s*\{document\}/u;
const END_DOCUMENT = /^\s*\\end\s*\{document\}/u;
const PICTURE = /^\s*\\begin\s*\{(?:tikzpicture|circuitikz)\}/u;
const LOADER = /^\s*\\(?:usepackage|RequirePackage|usetikzlibrary|usepgfplotslibrary|usepgflibrary|usecircuitikzlibrary)\b/u;
const LIBRARY = /^\s*\\use(?:tikz|pgfplots|pgf|circuitikz)library\b/u;
const PACKAGE_COMMANDS = ["usepackage", "RequirePackage"];
const QUIET = /^\s*(?:%.*)?$/u;

interface PackageLine {
  options: string | undefined;
  names: string;
}

function packageLine(text: string): PackageLine | null {
  const start = text.trimStart();
  const command = start.startsWith("\\") ? PACKAGE_COMMANDS.find((name) => start.startsWith(name, 1)) : undefined;
  if (!command) return null;
  let rest = start.slice(1 + command.length).trimStart();
  let options: string | undefined;
  if (rest.startsWith("[")) {
    const close = rest.indexOf("]");
    if (close < 0) return null;
    options = rest.slice(1, close);
    rest = rest.slice(close + 1).trimStart();
  }
  const end = rest.startsWith("{") ? rest.indexOf("}") : -1;
  if (end < 0 || !QUIET.test(rest.slice(end + 1))) return null;
  return { options, names: rest.slice(1, end) };
}

function sourceLines(source: string, shared = false): SourceLine[] {
  return source
    .replaceAll(/\r\n?/gu, "\n")
    .split("\n")
    .map((text, index) => ({ text, line: index + 1, shared }));
}

function origin({ line, shared }: SourceLine): SourceOrigin {
  return { line, shared };
}

function trimmed(lines: SourceLine[]): SourceLine[] {
  let start = 0;
  let end = lines.length;
  while (start < end && !lines[start].text.trim()) start += 1;
  while (end > start && !lines[end - 1].text.trim()) end -= 1;
  return lines.slice(start, end);
}

function loaderCount(lines: readonly SourceLine[]): number {
  const index = lines.findIndex(({ text }) => !LOADER.test(text) && !QUIET.test(text));
  return index < 0 ? lines.length : index;
}

function tikzParts(source: string, sharedPreamble: string): TikzParts {
  const shared = sharedPreamble.trim() ? sourceLines(sharedPreamble, true) : [];
  const lines = sourceLines(source);
  const whole = lines.some(({ text }) => DOCUMENT_CLASS.test(text));
  const opening = lines.findIndex(({ text }) => BEGIN_DOCUMENT.test(text));
  if (opening >= 0) {
    const closing = lines.findIndex(({ text }, index) => index > opening && END_DOCUMENT.test(text));
    return {
      whole,
      preamble: [...(whole ? [] : shared), ...lines.slice(0, opening).filter(({ text }) => !DOCUMENT_CLASS.test(text))],
      body: trimmed(lines.slice(opening + 1, closing < 0 ? undefined : closing)),
      wrap: false,
    };
  }
  const picture = lines.findIndex(({ text }) => PICTURE.test(text));
  const split = picture >= 0 ? picture : loaderCount(lines);
  return {
    whole: false,
    preamble: [...shared, ...lines.slice(0, split).filter(({ text }) => !DOCUMENT_CLASS.test(text))],
    body: trimmed(lines.slice(split)),
    wrap: picture < 0,
  };
}

function declaredPackages(preamble: readonly SourceLine[]): LatexPackage[] {
  return preamble.flatMap(({ text }) => {
    const declared = packageLine(text);
    if (!declared) return [];
    const options = (declared.options ?? "").trim();
    return declared.names
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean)
      .map((name) => ({ name, options }));
  });
}

function basePackage(kind: TikzKind, declared: readonly LatexPackage[]): LatexPackage[] {
  return declared.some((entry) => entry.name === kind) ? [] : [{ name: kind, options: "" }];
}

export function tikzDocument(source: string, kind: TikzKind, sharedPreamble = ""): TikzDocument {
  const parts = tikzParts(source, sharedPreamble);
  if (parts.whole) {
    const lines = sourceLines(source);
    return { text: lines.map(({ text }) => text).join("\n"), lines: lines.map(origin) };
  }
  const text: string[] = [];
  const lines: (SourceOrigin | null)[] = [];
  const add = (value: string, line: SourceOrigin | null) => {
    text.push(value);
    lines.push(line);
  };
  add("\\documentclass[border=4pt]{standalone}", null);
  add("\\usepackage{amsmath,amssymb}", null);
  for (const entry of basePackage(kind, declaredPackages(parts.preamble))) add(usepackageLine(entry.name, entry.options), null);
  for (const line of parts.preamble) add(line.text, origin(line));
  add("\\begin{document}", null);
  if (parts.wrap) add(String.raw`\begin{${ENVIRONMENT[kind]}}`, null);
  for (const line of parts.body) add(line.text, origin(line));
  if (parts.wrap) add(String.raw`\end{${ENVIRONMENT[kind]}}`, null);
  add("\\end{document}", null);
  return { text: `${text.join("\n")}\n`, lines };
}

export function tikzFigure(source: string, kind: TikzKind, sharedPreamble = ""): TikzFigure {
  const parts = tikzParts(source, sharedPreamble);
  const declared = declaredPackages(parts.preamble);
  const setup = parts.preamble.filter(({ text }) => !packageLine(text) && !LIBRARY.test(text) && !QUIET.test(text));
  const libraries = parts.preamble.filter(({ text }) => LIBRARY.test(text));
  const body = parts.body.map(({ text }) => text);
  return {
    packages: [...basePackage(kind, declared), ...declared],
    lines: [
      ...libraries.map(({ text }) => text.trim()),
      "\\begin{figure}[htbp]",
      "  \\centering",
      ...setup.map(({ text }) => text),
      ...(parts.wrap ? [String.raw`\begin{${ENVIRONMENT[kind]}}`, ...body, String.raw`\end{${ENVIRONMENT[kind]}}`] : body),
      "\\end{figure}",
    ],
  };
}

export function blockLine(document: TikzDocument, line: number): SourceOrigin | null {
  return document.lines[line - 1] ?? null;
}
