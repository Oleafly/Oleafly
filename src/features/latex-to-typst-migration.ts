import { convertLatexMath } from "@oleafly/editor/latex-to-typst-math";
import {
  compileProject,
  convertAdHoc,
  createProjectFromAdHoc,
  listFiles,
  readFileBase64,
  type AdHocArtifact,
  type AdHocConversionRequest,
  type AdHocConversionResult,
  type CompileResult,
  type CreateAdHocProjectRequest,
} from "@/lib/tauri";
import { ensurePandoc } from "@/features/pandoc";
import {
  CONVERTED_MAIN_FILE,
  commentStart,
  directoryOf,
  normalizePath,
  typstSupportFiles,
} from "@/features/arxiv-typst";
import { base64ToBytes, textToBase64 } from "@/lib/base64";

export interface LineOrigin {
  readonly file: string;
  readonly line: number;
}

export type MigrationIncludeKind = "input" | "include" | "subfile";

export interface MigrationInclude {
  readonly id: number;
  readonly source: string;
  readonly target: string;
  readonly kind: MigrationIncludeKind;
  readonly origin: LineOrigin;
}

export interface PreparedLatex {
  readonly text: string;
  readonly origins: readonly LineOrigin[];
  readonly includes: readonly MigrationInclude[];
  readonly missing: readonly { readonly name: string; readonly origin: LineOrigin }[];
  readonly graphicsPaths: readonly string[];
  readonly bibliographyStyle: string | null;
  readonly raw: readonly string[];
  readonly equationAliases: Readonly<Record<string, string>>;
}

export type MigrationNoteKind =
  | "pandoc"
  | "missingInclude"
  | "lostInclude"
  | "missingImage"
  | "unsupportedImage"
  | "math"
  | "bibliographyStyle"
  | "skippedFile"
  | "unreadableFile"
  | "equationLabel";

export interface MigrationNote {
  readonly kind: MigrationNoteKind;
  readonly detail: string;
  readonly source?: LineOrigin;
}

export interface MigrationCompileProblem {
  readonly severity: "error" | "warning";
  readonly message: string;
  readonly file: string | null;
  readonly line: number | null;
}

export interface MigrationReport {
  readonly projectId: string;
  readonly projectName: string;
  readonly mainFile: string;
  readonly files: readonly string[];
  readonly converted: {
    readonly sources: readonly { readonly source: string; readonly target: string }[];
    readonly figures: number;
    readonly tables: number;
    readonly equations: number;
    readonly mathFixed: number;
    readonly references: number;
    readonly bibliographies: readonly string[];
    readonly copied: number;
    readonly style: string | null;
  };
  readonly attention: readonly MigrationNote[];
  readonly compile: { readonly ok: boolean; readonly problems: readonly MigrationCompileProblem[] } | null;
  readonly compileFailure?: string;
}

export type MigrationStep = "reading" | "converting" | "creating" | "compiling";

export type MigrationErrorCode = "pandoc" | "noMain" | "emptyOutput";

export class MigrationError extends Error {
  constructor(readonly code: MigrationErrorCode) {
    super(code);
    this.name = "MigrationError";
  }
}

export interface MigrationRequest {
  readonly projectId: string;
  readonly mainDoc: string;
  readonly name: string;
  readonly typstVersion: string | null;
  readonly buffers?: ReadonlyMap<string, string>;
}

type ProjectEntry = Awaited<ReturnType<typeof listFiles>>[number];

export interface MigrationDeps {
  listFiles(projectId: string): Promise<readonly ProjectEntry[]>;
  readFileBase64(projectId: string, path: string): Promise<string>;
  ensurePandoc(): Promise<boolean>;
  convert(request: AdHocConversionRequest): Promise<AdHocConversionResult>;
  createProject(request: CreateAdHocProjectRequest): Promise<string>;
  compile(projectId: string, mainDoc: string): Promise<CompileResult>;
}

const MARKER_PREFIX = "OLEAFLYINCLUDE";
const MARKER_LINE = /^\s*OLEAFLYINCLUDE(BEGIN|END)(\d+)\s*$/u;
const MARKER_ANYWHERE = /OLEAFLYINCLUDE(?:BEGIN|END)(\d+)/gu;
const RAW_PREFIX = "OLEAFLYRAW";
const RAW_LINE = /^\s*OLEAFLYRAW(\d+)\s*$/u;
const RAW_ANYWHERE = /OLEAFLYRAW\d+/gu;
const WIDE_FLOAT = /\\(begin|end)\{(figure|table)\*\}/gu;
const MULTILINE_MATH = /\\begin\{(align|gather|multline|flalign|alignat|eqnarray)(\*?)\}([\s\S]*?)\\end\{\1\2\}/gu;
const LATEX_LABEL = /\\label\s*\{([^{}]+)\}/gu;
const BLOCK_LABEL_LINE = /^\]\s*<([^<>\s]+)>\s*$/u;
const BLOCK_HEADING = "#strong[";
const STRUCTURE: Readonly<Record<string, string>> = {
  "\\tableofcontents": "#outline()",
  "\\listoffigures": "#outline(title: [List of Figures], target: figure.where(kind: image))",
  "\\listoftables": "#outline(title: [List of Tables], target: figure.where(kind: table))",
  "\\appendix": '#counter(heading).update(0)\n#set heading(numbering: "A.1")',
  "\\clearpage": "#pagebreak(weak: true)",
  "\\newpage": "#pagebreak(weak: true)",
  "\\pagebreak": "#pagebreak(weak: true)",
  "\\cleardoublepage": '#pagebreak(weak: true, to: "odd")',
};
const MAX_DEPTH = 8;
const MAX_INCLUDES = 500;
const MAX_FILES = 4000;
const MAX_TOTAL_BASE64 = 240 * 1024 * 1024;
const MAX_NOTE_DETAIL = 160;
const MAX_PROBLEMS = 200;
const INCLUDE_COMMAND = /\\(input|include|subfile)(?:\s*\{([^{}]+)\}|\s+([^\s{}%\\]+))/gu;
const INCLUDE_ALONE = /^\s*\\(input|include|subfile)(?:\s*\{([^{}]+)\}|\s+([^\s{}%\\]+))\s*$/u;
const BEGIN_DOCUMENT = /\\begin\s*\{document\}/u;
const END_DOCUMENT = /\\end\s*\{document\}/u;
const ENVIRONMENT = /\\(begin|end)\s*\{([^{}]+)\}/gu;
const GRAPHICS_PATH = /\\graphicspath\s*\{((?:\s*\{[^{}]*\})*)\s*\}/u;
const BIBLIOGRAPHY_STYLE = /\\bibliographystyle\s*\{([^{}]+)\}/u;
const LATEX_SOURCE = /\.(?:tex|ltx)$/iu;
const SKIP_READ: readonly RegExp[] = [
  /\.(?:aux|log|out|toc|lof|lot|blg|bbl|bcf|run\.xml|fls|fdb_latexmk)$/iu,
  /\.(?:synctex\.gz|synctex|nav|snm|vrb|xdv|dvi|idx|ind|ilg|glo|gls|glg|ist)$/iu,
];
const TYPST_IMAGE_EXTENSIONS = [".pdf", ".png", ".jpg", ".jpeg", ".svg", ".gif", ".webp"];
const UNSUPPORTED_IMAGE_EXTENSIONS = [".eps", ".ps"];
const REFERENCE_LINK = /#link\(<([^<>\s]+)>\)\[((?:\\.|[^\]\\\n])*)\]/gu;
const IMAGE_CALL = /\bimage\(\s*"((?:\\.|[^"\\\n])*)"/gu;
const DISPLAY_ESCAPED_MATH = /\\\$\\\$([\s\S]*?)\\\$\\\$/gu;
const INLINE_ESCAPED_MATH = /\\\$((?:[^$\n]|\n(?!\n))+?)\\\$/gu;
const LATEX_COMMAND = /\\[A-Za-z]/u;
const KEPT_MATH = "OLEAFLYKEPTMATH";
const KEPT_MATH_TOKEN = /OLEAFLYKEPTMATH(\d+)OLEAFLYKEPTMATH/gu;
const LABELLED_EQUATION = /\$\s?<[\w:.-]+>/u;
const TYPST_LABEL = /^[\w:.-]+$/u;
const CONF_SHOW = "#show: doc => conf(";
const EQUATION_NUMBERING = '#set math.equation(numbering: "(1)")';
const BIBLIOGRAPHY_CALL = /#bibliography\(((?:[^()\n]|\([^()\n]*\))*)\)/u;
const SHARED_DEFINITION_HEAD = /^#let ([A-Za-z_][\w-]*)\s*=/u;
const LINE_TERMINATORS = new Set(["\n", "\r", "\u2028", "\u2029"]);
const HARMLESS_SKIP_PREFIX = "Skipped '\\";
const HARMLESS_SKIP_SYMBOLS = new Set([";", ",", "!"]);
const HARMLESS_SKIP_ENVIRONMENTS = ["begin{titlepage}", "end{titlepage}"];
const HARMLESS_SKIP_COMMANDS = new Set([
  "centering",
  "maketitle",
  "noindent",
  "bibliographystyle",
  "vspace",
  "hspace",
  "vfill",
  "hfill",
  "smallskip",
  "medskip",
  "bigskip",
  "raggedright",
  "raggedleft",
  "sloppy",
  "protect",
  "phantomsection",
  "FloatBarrier",
  "balance",
  "newpage",
  "clearpage",
  "cleardoublepage",
  "IEEEoverridecommandlockouts",
  "IEEEpeerreviewmaketitle",
  "label",
  "tiny",
  "scriptsize",
  "footnotesize",
  "small",
  "normalsize",
  "large",
  "Large",
  "LARGE",
  "huge",
  "Huge",
  "setlength",
  "addtolength",
  "pagenumbering",
  "pgfplotsset",
  "usetikzlibrary",
  "lstset",
  "onehalfspacing",
  "doublespacing",
  "singlespacing",
  "SetAlgoLined",
  "cmidrule",
  "addcontentsline",
  "thispagestyle",
  "pagestyle",
  "tableofcontents",
  "listoffigures",
  "listoftables",
  "appendix",
  "quad",
  "qquad",
]);
const UNCONVERTED_MATH_REPORT = /^Could not convert TeX math ([\s\S]*?),? rendering as TeX:?$/u;

const BIBLIOGRAPHY_STYLES: Readonly<Record<string, string>> = {
  plain: "ieee",
  unsrt: "ieee",
  abbrv: "ieee",
  ieeetr: "ieee",
  ieeetran: "ieee",
  ieeetrann: "ieee",
  ieeetrans: "ieee",
  siam: "ieee",
  siamplain: "ieee",
  apalike: "apa",
  apa: "apa",
  apacite: "apa",
  plainnat: "chicago-author-date",
  abbrvnat: "chicago-author-date",
  unsrtnat: "chicago-author-date",
  chicago: "chicago-author-date",
  agsm: "harvard-cite-them-right",
  harvard: "harvard-cite-them-right",
  acm: "association-for-computing-machinery",
  "acm-reference-format": "association-for-computing-machinery",
  nature: "nature",
  naturemag: "nature",
  splncs03: "springer-lecture-notes-in-computer-science",
  splncs04: "springer-lecture-notes-in-computer-science",
  spmpsci: "springer-mathphys",
  "elsarticle-harv": "elsevier-harvard",
  "elsarticle-num": "elsevier-with-titles",
  "elsarticle-num-names": "elsevier-with-titles",
  vancouver: "vancouver",
  science: "american-association-for-the-advancement-of-science",
  "model1-num-names": "elsevier-with-titles",
};

function codeOf(line: string): string {
  return line.slice(0, commentStart(line));
}

function includeName(match: RegExpExecArray | RegExpMatchArray): string {
  return (match[2] ?? match[3] ?? "").trim();
}

function includeKind(command: string): MigrationIncludeKind {
  if (command === "include") return "include";
  return command === "subfile" ? "subfile" : "input";
}

function environmentDelta(code: string): number {
  let delta = 0;
  for (const match of code.matchAll(ENVIRONMENT)) {
    if (match[2].trim() === "document") continue;
    delta += match[1] === "begin" ? 1 : -1;
  }
  return delta;
}

function typstTargetFor(source: string, mainDirectory: string): string {
  const relative = mainDirectory && source.startsWith(mainDirectory) ? source.slice(mainDirectory.length) : source;
  const target = `${relative.replace(LATEX_SOURCE, "")}.typ`;
  return target === CONVERTED_MAIN_FILE ? `${relative.replace(LATEX_SOURCE, "")}-part.typ` : target;
}

class LatexPreparer {
  private readonly lines: string[] = [];
  private readonly origins: LineOrigin[] = [];
  private readonly includes: MigrationInclude[] = [];
  private readonly missing: { name: string; origin: LineOrigin }[] = [];
  private readonly raw: string[] = [];
  private readonly mainDirectory: string;

  constructor(
    private readonly mainFile: string,
    private readonly texts: ReadonlyMap<string, string>,
  ) {
    this.mainDirectory = directoryOf(normalizePath(mainFile) ?? mainFile);
  }

  prepare(): PreparedLatex {
    const main = this.texts.get(this.mainFile) ?? "";
    const lines = main.split("\n");
    const begin = lines.findIndex((line) => BEGIN_DOCUMENT.test(codeOf(line)));
    if (begin < 0) {
      this.body(main, this.mainFile, 1, [this.mainFile]);
    } else {
      this.inline(lines.slice(0, begin + 1).join("\n"), this.mainFile, 1, [this.mainFile]);
      this.body(lines.slice(begin + 1).join("\n"), this.mainFile, begin + 2, [this.mainFile]);
    }
    const code = this.lines.map(codeOf).join("\n");
    return {
      text: this.lines.join("\n"),
      origins: this.origins,
      includes: this.includes,
      missing: this.missing,
      graphicsPaths: graphicsPaths(code),
      bibliographyStyle: BIBLIOGRAPHY_STYLE.exec(code)?.[1]?.trim() ?? null,
      raw: this.raw,
      equationAliases: equationAliases(code),
    };
  }

  private push(line: string, origin: LineOrigin): void {
    this.lines.push(line.replace(WIDE_FLOAT, String.raw`\$1{$2}`));
    this.origins.push(origin);
  }

  private structure(code: string, origin: LineOrigin): boolean {
    const typst = STRUCTURE[code.trim()];
    if (typst === undefined) return false;
    const id = this.raw.length;
    this.raw.push(typst);
    for (const line of ["", `${RAW_PREFIX}${id}`, ""]) this.push(line, origin);
    return true;
  }

  private resolve(name: string): string | null {
    const candidates = /\.[A-Za-z0-9]+$/u.test(name) ? [name] : [`${name}.tex`, name];
    for (const candidate of candidates) {
      for (const base of [this.mainDirectory, ""]) {
        const path = normalizePath(`${base}${candidate}`);
        if (path !== null && this.texts.has(path)) return path;
      }
    }
    return null;
  }

  private fragment(path: string): { text: string; firstLine: number } {
    const text = this.texts.get(path) ?? "";
    const lines = text.split("\n");
    const begin = lines.findIndex((line) => BEGIN_DOCUMENT.test(codeOf(line)));
    if (begin < 0) return { text, firstLine: 1 };
    const end = lines.findIndex((line, index) => index > begin && END_DOCUMENT.test(codeOf(line)));
    return { text: lines.slice(begin + 1, end < 0 ? undefined : end).join("\n"), firstLine: begin + 2 };
  }

  private canEnter(path: string, stack: readonly string[]): boolean {
    return !stack.includes(path) && stack.length < MAX_DEPTH;
  }

  private inlineText(text: string, stack: readonly string[]): string {
    return text
      .split("\n")
      .map((line) => {
        const cut = commentStart(line);
        const code = line.slice(0, cut).replace(INCLUDE_COMMAND, (whole: string, _command: string, braced?: string, bare?: string) => {
          const path = this.resolve((braced ?? bare ?? "").trim());
          if (!path || !this.canEnter(path, stack)) return whole;
          return this.inlineText(this.fragment(path).text, [...stack, path]);
        });
        return code + line.slice(cut);
      })
      .join("\n");
  }

  private inlineLine(line: string, origin: LineOrigin, stack: readonly string[]): void {
    const cut = commentStart(line);
    const code = line.slice(0, cut);
    for (const match of code.matchAll(INCLUDE_COMMAND)) {
      const name = includeName(match);
      if (!this.resolve(name)) this.missing.push({ name, origin });
    }
    const expanded = this.inlineText(code, stack) + line.slice(cut);
    for (const part of expanded.split("\n")) this.push(part, origin);
  }

  private inlineAlone(line: string, match: RegExpExecArray, origin: LineOrigin, stack: readonly string[]): void {
    const name = includeName(match);
    const path = this.resolve(name);
    if (!path) {
      this.missing.push({ name, origin });
      this.push(line, origin);
      return;
    }
    if (!this.canEnter(path, stack)) {
      this.push(line, origin);
      return;
    }
    const fragment = this.fragment(path);
    this.inline(fragment.text, path, fragment.firstLine, [...stack, path]);
  }

  private inline(text: string, file: string, firstLine: number, stack: readonly string[]): void {
    text.split("\n").forEach((line, index) => {
      const origin = { file, line: firstLine + index };
      const alone = INCLUDE_ALONE.exec(codeOf(line));
      if (alone) this.inlineAlone(line, alone, origin, stack);
      else if (codeOf(line).search(INCLUDE_COMMAND) >= 0) this.inlineLine(line, origin, stack);
      else this.push(line, origin);
    });
  }

  private separate(match: RegExpExecArray, line: string, origin: LineOrigin, stack: readonly string[]): void {
    const name = includeName(match);
    const path = this.resolve(name);
    if (!path) {
      this.missing.push({ name, origin });
      this.push(line, origin);
      return;
    }
    if (!this.canEnter(path, stack) || this.includes.length >= MAX_INCLUDES) {
      this.push(line, origin);
      return;
    }
    const id = this.includes.length;
    this.includes.push({
      id,
      source: path,
      target: typstTargetFor(path, this.mainDirectory),
      kind: includeKind(match[1]),
      origin,
    });
    for (const marker of ["", `${MARKER_PREFIX}BEGIN${id}`, ""]) this.push(marker, origin);
    const fragment = this.fragment(path);
    this.body(fragment.text, path, fragment.firstLine, [...stack, path]);
    for (const marker of ["", `${MARKER_PREFIX}END${id}`, ""]) this.push(marker, origin);
  }

  private body(text: string, file: string, firstLine: number, stack: readonly string[]): void {
    let depth = 0;
    text.split("\n").forEach((line, index) => {
      const origin = { file, line: firstLine + index };
      const code = codeOf(line);
      const alone = INCLUDE_ALONE.exec(code);
      if (depth === 0 && this.structure(code, origin)) return;
      if (alone && depth === 0) this.separate(alone, line, origin, stack);
      else if (alone) this.inlineAlone(line, alone, origin, stack);
      else if (code.search(INCLUDE_COMMAND) >= 0) this.inlineLine(line, origin, stack);
      else this.push(line, origin);
      depth = Math.max(0, depth + environmentDelta(code));
    });
  }
}

function equationAliases(code: string): Record<string, string> {
  const aliases: Record<string, string> = {};
  for (const math of code.matchAll(MULTILINE_MATH)) {
    const labels = [...math[3].matchAll(LATEX_LABEL)].map((match) => match[1].trim());
    for (const label of labels.slice(1)) {
      if (label !== labels[0]) aliases[label] = labels[0];
    }
  }
  return aliases;
}

function graphicsPaths(code: string): string[] {
  const match = GRAPHICS_PATH.exec(code);
  if (!match) return [];
  return [...match[1].matchAll(/\{([^{}]*)\}/gu)]
    .map((entry) => entry[1].trim().replace(/^\.\//u, ""))
    .filter(Boolean)
    .map((entry) => (entry.endsWith("/") ? entry : `${entry}/`));
}

export function prepareLatexProject(mainFile: string, texts: ReadonlyMap<string, string>): PreparedLatex {
  return new LatexPreparer(mainFile, texts).prepare();
}

export function relativeTypstPath(fromFile: string, toFile: string): string {
  const from = directoryOf(fromFile).split("/").filter(Boolean);
  const to = toFile.split("/");
  let common = 0;
  while (common < from.length && common < to.length - 1 && from[common] === to[common]) common += 1;
  return [...Array.from({ length: from.length - common }, () => ".."), ...to.slice(common)].join("/");
}

function trimBlankLines(lines: readonly string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start].trim() === "") start += 1;
  while (end > start && lines[end - 1].trim() === "") end -= 1;
  return lines.slice(start, end);
}

function includeStatement(include: MigrationInclude, parentTarget: string): string {
  const statement = `#include "${relativeTypstPath(parentTarget, include.target)}"`;
  return include.kind === "include" ? `#pagebreak(weak: true)\n${statement}` : statement;
}

interface SplitFrame {
  readonly id: number | null;
  readonly lines: string[];
}

function lastFrameIndex(stack: readonly SplitFrame[], id: number): number {
  for (let index = stack.length - 1; index >= 0; index -= 1) {
    if (stack[index].id === id) return index;
  }
  return -1;
}

export interface SplitIncludes {
  readonly main: string;
  readonly parts: readonly { readonly target: string; readonly text: string }[];
  readonly lost: readonly number[];
}

class IncludeSplitter {
  private readonly byId: ReadonlyMap<number, MigrationInclude>;
  private readonly stack: SplitFrame[] = [{ id: null, lines: [] }];
  private readonly parts: { target: string; text: string }[] = [];
  private readonly written = new Set<string>();
  private readonly lost = new Set<number>();

  constructor(
    includes: readonly MigrationInclude[],
    private readonly raw: readonly string[],
  ) {
    this.byId = new Map(includes.map((include) => [include.id, include]));
  }

  split(typst: string): SplitIncludes {
    for (const line of typst.split("\n")) this.line(line);
    this.unwindTo(1);
    return { main: this.stack[0].lines.join("\n"), parts: this.parts, lost: [...this.lost] };
  }

  private top(): SplitFrame {
    return this.stack.at(-1) ?? this.stack[0];
  }

  private unwindTo(length: number): void {
    while (this.stack.length > length) {
      const inner = this.stack.pop();
      if (!inner) return;
      if (inner.id !== null) this.lost.add(inner.id);
      this.top().lines.push(...inner.lines);
    }
  }

  private line(line: string): void {
    const placeholder = RAW_LINE.exec(line);
    if (placeholder) {
      this.top().lines.push(this.raw[Number(placeholder[1])] ?? "");
      return;
    }
    if (line.includes(RAW_PREFIX)) {
      this.top().lines.push(line.replaceAll(RAW_ANYWHERE, "").trimEnd());
      return;
    }
    const marker = MARKER_LINE.exec(line);
    if (marker) {
      this.marker(marker[1], Number(marker[2]));
      return;
    }
    if (line.includes(MARKER_PREFIX)) {
      for (const match of line.matchAll(MARKER_ANYWHERE)) this.lost.add(Number(match[1]));
      this.top().lines.push(line.replaceAll(MARKER_ANYWHERE, "").trimEnd());
      return;
    }
    this.top().lines.push(line);
  }

  private marker(kind: string, id: number): void {
    const include = this.byId.get(id);
    if (!include) {
      this.lost.add(id);
      return;
    }
    if (kind === "BEGIN") {
      this.stack.push({ id, lines: [] });
      return;
    }
    const index = lastFrameIndex(this.stack, id);
    if (index <= 0) {
      this.lost.add(id);
      return;
    }
    this.unwindTo(index + 1);
    const frame = this.stack.pop();
    if (frame) this.close(include, frame);
  }

  private close(include: MigrationInclude, frame: SplitFrame): void {
    const parentId = this.top().id;
    const parentTarget = parentId === null ? CONVERTED_MAIN_FILE : (this.byId.get(parentId)?.target ?? CONVERTED_MAIN_FILE);
    if (!this.written.has(include.target)) {
      this.written.add(include.target);
      this.parts.push({ target: include.target, text: `${trimBlankLines(frame.lines).join("\n")}\n` });
    }
    this.top().lines.push(includeStatement(include, parentTarget));
  }
}

export function splitConvertedIncludes(
  typst: string,
  includes: readonly MigrationInclude[],
  raw: readonly string[] = [],
): SplitIncludes {
  return new IncludeSplitter(includes, raw).split(typst);
}

export function fixCrossReferences(text: string): { text: string; count: number } {
  let count = 0;
  const fixed = text.replace(REFERENCE_LINK, (whole: string, label: string, body: string) => {
    const shown = body.trim();
    const reference = /^[\d.]+$/u.test(shown) || shown === String.raw`\[${label}\]` || shown === label;
    if (!reference) return whole;
    count += 1;
    return TYPST_LABEL.test(label) ? `@${label}` : `#ref(<${label}>)`;
  });
  return { text: fixed, count };
}

function referencePattern(label: string): RegExp {
  return new RegExp(String.raw`@${escapeRegExp(label)}(?![\w-]|[:.][\w-])`, "gu");
}

export function fixEquationAliases(
  text: string,
  aliases: Readonly<Record<string, string>>,
): { text: string; used: string[] } {
  const used: string[] = [];
  let fixed = text;
  for (const [label, equation] of Object.entries(aliases)) {
    const pattern = referencePattern(label);
    if (!pattern.test(fixed)) continue;
    used.push(label);
    fixed = fixed.replace(referencePattern(label), `@${equation}`);
  }
  return { text: fixed, used };
}

function isAsciiDigit(character: string | undefined): boolean {
  return character !== undefined && character >= "0" && character <= "9";
}

function isAsciiLetter(character: string | undefined): boolean {
  return character !== undefined && /^[A-Za-z]$/u.test(character);
}

function digitRunStart(text: string, end: number): number {
  let start = end;
  while (start > 0 && isAsciiDigit(text[start - 1])) start -= 1;
  return start;
}

function trailingBlockNumber(content: string): string | null {
  const end = isAsciiLetter(content.at(-1)) ? content.length - 1 : content.length;
  let start = digitRunStart(content, end);
  if (start === end) return null;
  while (start >= 2 && content[start - 1] === "." && isAsciiDigit(content[start - 2])) start = digitRunStart(content, start - 1);
  return content.slice(start);
}

function blockNumber(line: string): string | null {
  if (!line.startsWith(BLOCK_HEADING)) return null;
  const close = line.indexOf("]", BLOCK_HEADING.length);
  return close < 0 ? null : trailingBlockNumber(line.slice(BLOCK_HEADING.length, close));
}

function blockLabels(text: string): Map<string, string | null> {
  const labels = new Map<string, string | null>();
  const lines = text.split("\n");
  lines.forEach((line, index) => {
    const label = BLOCK_LABEL_LINE.exec(line)?.[1];
    if (!label) return;
    let number: string | null = null;
    for (let back = index - 1; back >= Math.max(0, index - 400); back -= 1) {
      if (lines[back].trim() !== "#block[") continue;
      number = blockNumber(lines[back + 1] ?? "");
      break;
    }
    labels.set(label, number);
  });
  return labels;
}

export function fixBlockReferences(texts: readonly string[]): string[] {
  const labels = new Map<string, string | null>();
  for (const text of texts) for (const [label, number] of blockLabels(text)) labels.set(label, number);
  if (labels.size === 0) return [...texts];
  return texts.map((text) => {
    let fixed = text;
    for (const [label, number] of labels) {
      fixed = fixed.replace(referencePattern(label), `#link(<${label}>)[${number ?? label}]`);
    }
    return fixed;
  });
}

function extensionOf(path: string): string {
  const match = /\.[A-Za-z0-9]+$/u.exec(path);
  return match ? match[0].toLowerCase() : "";
}

function imageCandidates(path: string, extensions: readonly string[]): string[] {
  const extension = extensionOf(path);
  if (extensions.includes(extension)) return [path];
  return extensions.map((candidate) => `${path}${candidate}`);
}

function resolveImage(
  raw: string,
  available: ReadonlySet<string>,
  graphicsPaths: readonly string[],
): { path: string | null; unsupported: string | null } {
  const bases = ["", ...graphicsPaths];
  const roots = bases
    .map((base) => normalizePath(`${base}${raw.replace(/^\.\//u, "")}`))
    .filter((path): path is string => path !== null && path !== "");
  for (const root of roots) {
    const found = imageCandidates(root, TYPST_IMAGE_EXTENSIONS).find((candidate) => available.has(candidate));
    if (found) return { path: found, unsupported: null };
  }
  for (const root of roots) {
    const found = imageCandidates(root, UNSUPPORTED_IMAGE_EXTENSIONS).find((candidate) => available.has(candidate));
    if (found) return { path: null, unsupported: found };
  }
  return { path: null, unsupported: null };
}

export function fixImagePaths(
  text: string,
  filePath: string,
  available: ReadonlySet<string>,
  graphicsPaths: readonly string[],
): { text: string; missing: string[]; unsupported: string[] } {
  const missing: string[] = [];
  const unsupported: string[] = [];
  const fixed = text.replace(IMAGE_CALL, (whole: string, raw: string) => {
    if (/^[a-z][a-z0-9+.-]*:/iu.test(raw) || raw.startsWith("/")) return whole;
    const resolved = resolveImage(raw, available, graphicsPaths);
    if (resolved.path) return whole.replace(`"${raw}"`, `"${relativeTypstPath(filePath, resolved.path)}"`);
    if (resolved.unsupported) unsupported.push(resolved.unsupported);
    else missing.push(raw);
    return whole;
  });
  return { text: fixed, missing, unsupported };
}

function unescapeTypstMarkup(text: string): string {
  return text.replace(/\\(.)/gsu, "$1");
}

function convertMathSource(latex: string, display: boolean, typstVersion: string | null): string | null {
  const labels = [...latex.matchAll(/\\label\s*\{([^{}]+)\}/gu)].map((match) => match[1].trim());
  let body = latex.replace(/\\label\s*\{[^{}]*\}/gu, "").replace(/\\(?:nonumber|notag)(?![A-Za-z])/gu, "");
  const environment = /^\s*\\begin\{(equation|displaymath|math)\*?\}([\s\S]*)\\end\{\1\*?\}\s*$/u.exec(body);
  if (environment) body = environment[2];
  const result = convertLatexMath(body.trim(), { typstVersion });
  if (!result.typst.trim() || result.unsupported.length > 0) return null;
  if (!display) return `$${result.typst}$`;
  const label = labels.find((candidate) => TYPST_LABEL.test(candidate));
  const suffix = label ? `<${label}>` : "";
  return `$ ${result.typst} $${suffix}`;
}

export function fixUnconvertedMath(
  text: string,
  typstVersion: string | null,
): { text: string; fixed: string[]; remaining: string[] } {
  const fixed: string[] = [];
  const remaining: string[] = [];
  const kept: string[] = [];
  const attempt = (whole: string, escaped: string, display: boolean): string => {
    const latex = unescapeTypstMarkup(escaped);
    if (!LATEX_COMMAND.test(latex)) return display ? keep(whole) : whole;
    const converted = convertMathSource(latex, display, typstVersion);
    if (converted === null) {
      remaining.push(latex.trim());
      return display ? keep(whole) : whole;
    }
    fixed.push(latex.trim());
    return converted;
  };
  const keep = (whole: string): string => {
    kept.push(whole);
    return `${KEPT_MATH}${kept.length - 1}${KEPT_MATH}`;
  };
  const displayDone = text.replace(DISPLAY_ESCAPED_MATH, (whole: string, escaped: string) => attempt(whole, escaped, true));
  const inlineDone = displayDone.replace(INLINE_ESCAPED_MATH, (whole: string, escaped: string) => attempt(whole, escaped, false));
  const restored = inlineDone.replace(KEPT_MATH_TOKEN, (_whole: string, index: string) => kept[Number(index)] ?? "");
  return { text: restored, fixed, remaining };
}

function closingParenthesis(text: string, open: number): number {
  let depth = 0;
  let inString = false;
  for (let index = open; index < text.length; index += 1) {
    const character = text[index];
    if (inString) {
      if (character === "\\") index += 1;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === "(") depth += 1;
    else if (character === ")") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

export function numberLabelledEquations(main: string, texts: readonly string[]): string {
  if (!texts.some((text) => LABELLED_EQUATION.test(text))) return main;
  if (/math\.equation\(\s*numbering/u.test(main)) return main;
  const show = main.indexOf(CONF_SHOW);
  const close = show < 0 ? -1 : closingParenthesis(main, show + CONF_SHOW.length - 1);
  if (close < 0) return `${EQUATION_NUMBERING}\n${main}`;
  const lineEnd = main.indexOf("\n", close);
  const at = lineEnd < 0 ? main.length : lineEnd;
  return `${main.slice(0, at)}\n${EQUATION_NUMBERING}${main.slice(at)}`;
}

export function typstStyleForBibtex(style: string | null): string | null {
  if (!style) return null;
  return BIBLIOGRAPHY_STYLES[style.trim().toLowerCase()] ?? null;
}

export function applyBibliographyStyle(main: string, latexStyle: string | null): { text: string; style: string | null } {
  const style = typstStyleForBibtex(latexStyle);
  const call = BIBLIOGRAPHY_CALL.exec(main);
  if (!style || !call || /\bstyle\s*:/u.test(call[1])) return { text: main, style: null };
  const replacement = `#bibliography(${call[1]}, style: "${style}")`;
  return { text: main.slice(0, call.index) + replacement + main.slice(call.index + call[0].length), style };
}

function balanced(line: string): boolean {
  const count = (character: string) => line.split(character).length - 1;
  return count("(") === count(")") && count("{") === count("}") && count("[") === count("]");
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`);
}

function hasOneLineValue(rest: string): boolean {
  let lastBreak = -1;
  for (let index = 0; index < rest.length; index += 1) {
    if (LINE_TERMINATORS.has(rest[index])) lastBreak = index;
  }
  return rest.length > lastBreak + 1 && rest.slice(0, lastBreak + 1).trim() === "";
}

function sharedDefinitionName(line: string): string | null {
  const head = SHARED_DEFINITION_HEAD.exec(line);
  return head && hasOneLineValue(line.slice(head[0].length)) ? head[1] : null;
}

export function carrySharedDefinitions(main: string, part: string): string {
  const show = main.indexOf(CONF_SHOW);
  if (show < 0) return part;
  const used = main
    .slice(0, show)
    .split("\n")
    .flatMap((line) => {
      const name = sharedDefinitionName(line);
      return name !== null && balanced(line) ? [{ line, name }] : [];
    })
    .filter(({ name }) => new RegExp(String.raw`#${escapeRegExp(name)}(?![\w-])`, "u").test(part));
  if (used.length === 0) return part;
  return `${used.map(({ line }) => line).join("\n")}\n\n${part}`;
}

function collapse(text: string): string {
  return text.replace(/\s+/gu, " ").trim();
}

function shorten(text: string): string {
  const collapsed = collapse(text);
  return collapsed.length > MAX_NOTE_DETAIL ? `${collapsed.slice(0, MAX_NOTE_DETAIL - 3)}...` : collapsed;
}

function wasFixed(report: string, fixed: readonly string[]): boolean {
  const math = UNCONVERTED_MATH_REPORT.exec(report);
  if (!math) return false;
  const reported = collapse(math[1]);
  return fixed.some((source) => {
    const candidate = collapse(source);
    return reported.includes(candidate.slice(0, 60)) || candidate.includes(reported.slice(0, 60));
  });
}

function harmlessSkip(entry: string): boolean {
  if (!entry.startsWith(HARMLESS_SKIP_PREFIX)) return false;
  const rest = entry.slice(HARMLESS_SKIP_PREFIX.length);
  const name = /^[A-Za-z]*/u.exec(rest)?.[0] ?? "";
  if (HARMLESS_SKIP_COMMANDS.has(name)) return true;
  const symbol = name === "" && HARMLESS_SKIP_SYMBOLS.has(rest.charAt(0)) ? rest.charAt(0) : null;
  const matched = symbol ?? HARMLESS_SKIP_ENVIRONMENTS.find((environment) => rest.startsWith(environment));
  return matched !== undefined && !isAsciiLetter(rest[matched.length]);
}

function literalStart(text: string, end: number, literal: string): number {
  return end >= literal.length && text.slice(end - literal.length, end) === literal ? end - literal.length : -1;
}

function spaceRunStart(text: string, end: number): number {
  let start = end;
  while (start > 0 && /\s/u.test(text[start - 1])) start -= 1;
  return start;
}

function texFileStart(text: string, end: number): number {
  const space = literalStart(text, end, ".tex ");
  if (space < 0) return -1;
  let start = end - 1;
  while (start > 0 && !/\s/u.test(text[start - 1])) start -= 1;
  return end - 1 - start > ".tex".length ? start : -1;
}

function reportLocation(entry: string): { index: number; line: number } | null {
  const end = entry.trimEnd().length;
  const column = digitRunStart(entry, end);
  const lineEnd = column < end ? literalStart(entry, column, " column ") : -1;
  const lineStart = lineEnd < 0 ? -1 : digitRunStart(entry, lineEnd);
  if (lineStart < 0 || lineStart === lineEnd) return null;
  const word = literalStart(entry, lineStart, "line ");
  if (word < 0) return null;
  const file = texFileStart(entry, word);
  const at = literalStart(entry, file < 0 ? word : file, "at ");
  const index = at < 0 ? -1 : spaceRunStart(entry, at);
  return index >= 0 && index < at ? { index, line: Number(entry.slice(lineStart, lineEnd)) } : null;
}

export function pandocReportNotes(
  report: readonly string[],
  origins: readonly LineOrigin[],
  fixed: readonly string[] = [],
): MigrationNote[] {
  const notes: MigrationNote[] = [];
  for (const entry of report) {
    if (harmlessSkip(entry) || entry.startsWith("Could not load include file") || wasFixed(entry, fixed)) continue;
    const location = reportLocation(entry);
    const detail = location ? entry.slice(0, location.index) : entry;
    const origin = location ? origins[location.line - 1] : undefined;
    notes.push(origin ? { kind: "pandoc", detail, source: origin } : { kind: "pandoc", detail });
  }
  return notes;
}

function decodeText(base64: string): string {
  return new TextDecoder("utf-8", { fatal: false }).decode(base64ToBytes(base64)).replace(/^\uFEFF/u, "");
}

function countMatches(texts: readonly string[], pattern: RegExp): number {
  return texts.reduce((total, text) => total + [...text.matchAll(pattern)].length, 0);
}

function projectRelative(file: string | null, created: readonly string[]): string | null {
  if (!file) return null;
  const normalized = file.replaceAll("\\", "/").replace(/^\.\//u, "");
  if (created.includes(normalized)) return normalized;
  return created.find((path) => normalized.endsWith(`/${path}`)) ?? normalized;
}

function compileProblems(result: CompileResult, created: readonly string[]): MigrationCompileProblem[] {
  const errors = result.errors.map((error) => ({
    severity: error.kind === "warning" ? ("warning" as const) : ("error" as const),
    message: error.message,
    file: projectRelative(error.file, created),
    line: error.line,
  }));
  const warnings = (result.diagnostics ?? [])
    .filter((diagnostic) => diagnostic.severity === "warning")
    .map((diagnostic) => ({
      severity: "warning" as const,
      message: diagnostic.message,
      file: projectRelative(diagnostic.file, created),
      line: diagnostic.line,
    }));
  return [...errors, ...warnings].slice(0, MAX_PROBLEMS);
}

interface ReadProject {
  readonly texts: Map<string, string>;
  readonly files: AdHocArtifact[];
  readonly attention: MigrationNote[];
}

function isHidden(path: string): boolean {
  return path.split("/").some((segment) => segment.startsWith("."));
}

interface ProjectReader extends ReadProject {
  readonly request: MigrationRequest;
  readonly deps: MigrationDeps;
  readonly compiledPdf: string;
  total: number;
}

function readablePath(entry: ProjectEntry, compiledPdf: string): string | null {
  if (entry.is_dir || entry.unreadable || entry.placeholder) return null;
  const path = normalizePath(entry.path);
  if (!path || isHidden(path) || SKIP_READ.some((pattern) => pattern.test(path)) || path === compiledPdf) return null;
  return path;
}

function storeRead(reader: ProjectReader, path: string, data: string): void {
  if (reader.total + data.length > MAX_TOTAL_BASE64) {
    reader.attention.push({ kind: "skippedFile", detail: path });
    return;
  }
  reader.total += data.length;
  if (LATEX_SOURCE.test(path)) reader.texts.set(path, decodeText(data));
  else reader.files.push({ path, dataBase64: data });
}

async function readEntry(reader: ProjectReader, entry: ProjectEntry): Promise<void> {
  const path = readablePath(entry, reader.compiledPdf);
  if (!path) return;
  const buffered = reader.request.buffers?.get(path);
  if (buffered !== undefined && LATEX_SOURCE.test(path)) {
    reader.texts.set(path, buffered);
    return;
  }
  if (reader.texts.size + reader.files.length >= MAX_FILES) {
    reader.attention.push({ kind: "skippedFile", detail: path });
    return;
  }
  let data: string;
  try {
    data = await reader.deps.readFileBase64(reader.request.projectId, path);
  } catch {
    reader.attention.push({ kind: "unreadableFile", detail: path });
    return;
  }
  storeRead(reader, path, data);
}

async function readProject(request: MigrationRequest, deps: MigrationDeps): Promise<ReadProject> {
  const entries = await deps.listFiles(request.projectId);
  const reader: ProjectReader = {
    request,
    deps,
    compiledPdf: `${request.mainDoc.replace(LATEX_SOURCE, "")}.pdf`,
    texts: new Map<string, string>(),
    files: [],
    attention: [],
    total: 0,
  };
  await entries.reduce<Promise<void>>((previous, entry) => previous.then(() => readEntry(reader, entry)), Promise.resolve());
  return { texts: reader.texts, files: reader.files, attention: reader.attention };
}

interface FixedDocuments {
  readonly documents: { target: string; text: string }[];
  readonly attention: MigrationNote[];
  readonly mathFixed: string[];
  readonly references: number;
}

function fixDocuments(
  split: SplitIncludes,
  support: ReadonlySet<string>,
  prepared: PreparedLatex,
  typstVersion: string | null,
): FixedDocuments {
  const attention: MigrationNote[] = [];
  const mathFixed: string[] = [];
  const aliased = new Set<string>();
  let references = 0;
  const documents = [{ target: CONVERTED_MAIN_FILE, text: split.main }, ...split.parts].map((document) => {
    const crossReferences = fixCrossReferences(document.text);
    references += crossReferences.count;
    const aliases = fixEquationAliases(crossReferences.text, prepared.equationAliases);
    for (const label of aliases.used) aliased.add(label);
    const images = fixImagePaths(aliases.text, document.target, support, prepared.graphicsPaths);
    for (const path of images.missing) attention.push({ kind: "missingImage", detail: path });
    for (const path of images.unsupported) attention.push({ kind: "unsupportedImage", detail: path });
    const math = fixUnconvertedMath(images.text, typstVersion);
    mathFixed.push(...math.fixed);
    for (const latex of math.remaining) attention.push({ kind: "math", detail: shorten(latex) });
    const text =
      document.target === CONVERTED_MAIN_FILE ? math.text : carrySharedDefinitions(split.main, math.text);
    return { target: document.target, text };
  });
  for (const label of aliased) attention.push({ kind: "equationLabel", detail: label });
  const linked = fixBlockReferences(documents.map((document) => document.text));
  return {
    documents: documents.map((document, index) => ({ target: document.target, text: linked[index] ?? document.text })),
    attention,
    mathFixed,
    references,
  };
}

export function defaultMigrationDeps(): MigrationDeps {
  return {
    listFiles,
    readFileBase64,
    ensurePandoc: () => ensurePandoc({ notify: true }),
    convert: convertAdHoc,
    createProject: createProjectFromAdHoc,
    compile: (projectId, mainDoc) => compileProject(projectId, mainDoc),
  };
}

export async function runLatexToTypstMigration(
  request: MigrationRequest,
  deps: MigrationDeps = defaultMigrationDeps(),
  onStep?: (step: MigrationStep) => void,
): Promise<MigrationReport> {
  onStep?.("reading");
  const mainFile = normalizePath(request.mainDoc) ?? request.mainDoc;
  const read = await readProject(request, deps);
  if (!read.texts.has(mainFile)) throw new MigrationError("noMain");
  const prepared = prepareLatexProject(mainFile, read.texts);

  onStep?.("converting");
  if (!(await deps.ensurePandoc())) throw new MigrationError("pandoc");
  const converted = await deps.convert({ source: "latex", target: "typst", text: prepared.text, report: true });
  if (!converted.text?.trim()) throw new MigrationError("emptyOutput");
  const split = splitConvertedIncludes(converted.text, prepared.includes, prepared.raw);
  const support = typstSupportFiles(read.files, mainFile);
  const supportPaths = new Set(support.map((file) => file.path));
  const fixed = fixDocuments(split, supportPaths, prepared, request.typstVersion);
  const [mainDocument, ...parts] = fixed.documents;
  const numbered = numberLabelledEquations(
    mainDocument.text,
    fixed.documents.map((document) => document.text),
  );
  const styled = applyBibliographyStyle(numbered, prepared.bibliographyStyle);

  const attention: MigrationNote[] = [
    ...read.attention,
    ...prepared.missing.map((missing) => ({ kind: "missingInclude" as const, detail: missing.name, source: missing.origin })),
    ...split.lost.flatMap((id) => {
      const include = prepared.includes.find((candidate) => candidate.id === id);
      return include ? [{ kind: "lostInclude" as const, detail: include.source, source: include.origin }] : [];
    }),
    ...fixed.attention,
    ...pandocReportNotes(converted.report ?? [], prepared.origins, fixed.mathFixed),
  ];
  if (prepared.bibliographyStyle && !styled.style) {
    attention.push({ kind: "bibliographyStyle", detail: prepared.bibliographyStyle });
  }

  const documents = [{ target: CONVERTED_MAIN_FILE, text: styled.text }, ...parts];
  const typstPaths = new Set(documents.map((document) => document.target));
  const copied = [
    ...support.filter((file) => !typstPaths.has(file.path)),
    ...converted.files.filter((file) => !typstPaths.has(file.path) && !supportPaths.has(file.path)),
  ];
  const projectFiles: AdHocArtifact[] = [
    ...documents.map((document) => ({ path: document.target, dataBase64: textToBase64(document.text) })),
    ...copied,
  ];

  onStep?.("creating");
  const projectId = await deps.createProject({
    name: request.name,
    target: "typst",
    mainFile: CONVERTED_MAIN_FILE,
    files: projectFiles,
  });

  onStep?.("compiling");
  const created = projectFiles.map((file) => file.path);
  let compile: MigrationReport["compile"] = null;
  let compileFailure: string | undefined;
  try {
    const result = await deps.compile(projectId, CONVERTED_MAIN_FILE);
    compile = { ok: result.ok, problems: compileProblems(result, created) };
  } catch (error) {
    compileFailure = error instanceof Error ? error.message : String(error);
  }

  const texts = documents.map((document) => document.text);
  const tables = countMatches(texts, /kind: table/gu);
  const includedSources = prepared.includes
    .filter((include) => !split.lost.includes(include.id))
    .filter((include, index, all) => all.findIndex((other) => other.target === include.target) === index)
    .map((include) => ({ source: include.source, target: include.target }));
  return {
    projectId,
    projectName: request.name,
    mainFile: CONVERTED_MAIN_FILE,
    files: created,
    converted: {
      sources: [{ source: mainFile, target: CONVERTED_MAIN_FILE }, ...includedSources],
      figures: Math.max(0, countMatches(texts, /#figure\(/gu) - tables),
      tables,
      equations: countMatches(texts, /(?:^|[^\\])\$ [^$]+ \$/gmu),
      mathFixed: fixed.mathFixed.length,
      references: fixed.references,
      bibliographies: copied.map((file) => file.path).filter((path) => /\.(?:bib|ya?ml)$/iu.test(path)),
      copied: copied.length,
      style: styled.style,
    },
    attention,
    compile,
    ...(compileFailure === undefined ? {} : { compileFailure }),
  };
}
