export type ImportCompatLevel = "info" | "warning" | "blocker";

export type ImportCompatAction =
  | "switch-to-latexmk"
  | "switch-to-pdflatex"
  | "install-after-switch"
  | "retry-compile";

type ImportCompatFindingParams = {
  file?: string;
  missing?: string[];
  status?: number;
};

export type ImportCompatFinding = {
  id: string;
  level: ImportCompatLevel;
  title: string;
  detail: string;
  params?: ImportCompatFindingParams;
};

export const IMPORT_COMPAT_CATALOG = {
  "biblatex-biber": {
    action: "switch-to-latexmk",
    level: "warning",
    title: "Bibliography uses biblatex / Biber",
    detail:
      "This project needs Biber to build the reference list. Oleafly ships a pinned tectonic-biber matched to its Tectonic engine. If citations stay as “?” after compile, check the log for a Biber note.",
    latexmkFixes: true,
  },
  minted: {
    action: "switch-to-latexmk",
    level: "blocker",
    title: "minted needs shell-escape and Pygments",
    detail:
      "Code listings via minted require a system TeX distribution and pygmentize. Switch to system LaTeX, then allow external commands on this computer only if you trust every project file.",
    latexmkFixes: true,
  },
  "glossaries-index": {
    action: "switch-to-latexmk",
    level: "blocker",
    title: "Glossary / index external tool",
    detail:
      "glossaries and makeindex need an external index run. The built-in engine can't do that, and system LaTeX can.",
    latexmkFixes: true,
  },
  pythontex: {
    action: "switch-to-latexmk",
    level: "blocker",
    title: "pythontex",
    detail:
      "PythonTeX needs its helper from the active system TeX distribution. Switch to system LaTeX, then allow external commands on this computer only if you trust every project file.",
    latexmkFixes: true,
  },
  "shell-escape": {
    action: "switch-to-latexmk",
    level: "warning",
    title: "Shell-escape commands",
    detail:
      String.raw`The source uses \write18 or another shell escape. Switch to system LaTeX, then allow external commands on this computer only if you trust every project file and the required host tools are installed.`,
    latexmkFixes: true,
  },
  fontspec: {
    action: "switch-to-latexmk",
    level: "info",
    title: "Custom fonts (fontspec)",
    detail:
      "fontspec needs the named fonts installed on this machine. Overleaf often ships fonts that are not present locally.",
    latexmkFixes: false,
  },
  "pdftex-only": {
    action: "switch-to-pdflatex",
    level: "info",
    title: "pdfTeX-oriented packages",
    detail:
      "Oleafly’s default engine is Tectonic (XeTeX-class), and this project relies on pdfTeX-only packages or primitives. The latexmk engine compiles with real pdfLaTeX, the same way Overleaf does.",
    latexmkFixes: true,
  },
  "cjk-pdftex-package": {
    action: "switch-to-pdflatex",
    level: "blocker",
    title: "CJKutf8 needs pdfLaTeX",
    detail:
      "CJKutf8 and CJK only work on pdfLaTeX. On the built-in engine (XeTeX) the document still compiles, but its Chinese, Japanese or Korean text is missing from the PDF. Switch to pdfLaTeX on system TeX, or replace the package with xeCJK.",
    latexmkFixes: true,
  },
  "class-compat": {
    action: "switch-to-latexmk",
    level: "warning",
    title: "Publisher class hits engine limits",
    detail:
      "The compile errors come from a class or style file, not from your document. Publisher classes often depend on tools or pdfTeX behavior the bundled Tectonic engine does not provide. The latexmk engine compiles with a full TeX distribution, the same way Overleaf does.",
    latexmkFixes: true,
  },
  "hyperref-pdftex-driver": {
    action: "switch-to-pdflatex",
    level: "blocker",
    title: "hyperref is pinned to the pdfTeX driver",
    detail:
      "This class or preamble forces hyperref's pdftex driver, which the built-in engine (XeTeX) cannot use. Switch to pdfLaTeX on system TeX, or drop the pdftex option so hyperref picks the driver itself.",
    latexmkFixes: true,
  },
  "eps-image": {
    action: "switch-to-pdflatex",
    level: "blocker",
    title: "EPS images need a converter",
    detail:
      "The built-in engine cannot place EPS images. Convert them to PDF with epstopdf or Inkscape, or switch to pdfLaTeX on system TeX, which converts EPS through Ghostscript.",
    latexmkFixes: true,
  },
  "missing-sty-on-bundled-engine": {
    action: "install-after-switch",
    level: "blocker",
    title: "A package is missing from the built-in bundle",
    detail:
      "Something this project loads is not in the built-in TeX bundle. Add the file to the project if it came with your template, or switch to system TeX and install the package from TeX Live.",
    latexmkFixes: true,
  },
  "bundle-fetch-failed": {
    action: "retry-compile",
    level: "blocker",
    title: "The TeX package download failed",
    detail:
      "Oleafly could not download TeX packages from its mirror, so the compile never reached your document. Check your connection and compile again. The download picks up where it stopped.",
    latexmkFixes: false,
  },
} as const satisfies Record<
  string,
  {
    action: ImportCompatAction;
    level: ImportCompatLevel;
    title: string;
    detail: string;
    latexmkFixes: boolean;
  }
>;

export type ImportCompatFindingId = keyof typeof IMPORT_COMPAT_CATALOG;

function findingFor(id: ImportCompatFindingId): ImportCompatFinding {
  const entry = IMPORT_COMPAT_CATALOG[id];
  return { id, level: entry.level, title: entry.title, detail: entry.detail };
}

export function importCompatFinding(id: ImportCompatFindingId): ImportCompatFinding {
  return findingFor(id);
}

export function latexmkFixesFinding(id: string): boolean {
  return id in IMPORT_COMPAT_CATALOG
    ? IMPORT_COMPAT_CATALOG[id as ImportCompatFindingId].latexmkFixes
    : false;
}

export function importCompatAction(id: string): ImportCompatAction {
  return id in IMPORT_COMPAT_CATALOG
    ? IMPORT_COMPAT_CATALOG[id as ImportCompatFindingId].action
    : "switch-to-latexmk";
}

export function needsPdflatexFinding(id: string): boolean {
  return importCompatAction(id) === "switch-to-pdflatex";
}

const SHELL_ESCAPE_FINDINGS: ReadonlySet<string> = new Set(["minted", "pythontex", "shell-escape"]);

export function needsShellEscapeFinding(id: string): boolean {
  return SHELL_ESCAPE_FINDINGS.has(id);
}

const MAX_SCAN_CHARS = 512 * 1024;

/** True if `tex[i]` starts a TeX line comment (`%` not escaped by `\`). */
function isCommentPercent(tex: string, i: number): boolean {
  if (tex[i] !== "%") return false;
  let backslashes = 0;
  for (let j = i - 1; j >= 0 && tex[j] === "\\"; j -= 1) backslashes += 1;
  return backslashes % 2 === 0;
}

export function stripLineComments(tex: string): string {
  let out = "";
  let i = 0;
  while (i < tex.length) {
    const ch = tex[i];
    if (ch === "\n") {
      out += ch;
      i += 1;
      continue;
    }
    if (isCommentPercent(tex, i)) {
      while (i < tex.length && tex[i] !== "\n") i += 1;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

const USEPACKAGE = String.raw`\usepackage`;

function skipBlanks(tex: string, from: number): number {
  let j = from;
  while (j < tex.length && (tex[j] === " " || tex[j] === "\t")) j += 1;
  return j;
}

function packageListMatches(list: string, pkg: string): boolean {
  for (const part of list.split(",")) {
    if (part.trim() === pkg) return true;
  }
  return false;
}

function scanUsepackageAt(
  tex: string,
  idx: number,
  pkg: string,
): { found: boolean; next: number | null } {
  let j = skipBlanks(tex, idx + USEPACKAGE.length);
  if (tex[j] === "[") {
    const closeOpt = tex.indexOf("]", j + 1);
    if (closeOpt === -1) return { found: false, next: idx + 1 };
    // Optional args can contain backend=biber etc.
    const opts = tex.slice(j + 1, closeOpt);
    if (pkg === "biber" && opts.includes("backend=biber")) return { found: true, next: null };
    j = skipBlanks(tex, closeOpt + 1);
  }
  if (tex[j] !== "{") return { found: false, next: idx + 1 };
  const close = tex.indexOf("}", j + 1);
  if (close === -1) return { found: false, next: null };
  if (packageListMatches(tex.slice(j + 1, close), pkg)) return { found: true, next: null };
  return { found: false, next: close + 1 };
}

export function loadsPackage(tex: string, pkg: string): boolean {
  let from = 0;
  while (from < tex.length) {
    const idx = tex.indexOf(USEPACKAGE, from);
    if (idx === -1) return false;
    const scan = scanUsepackageAt(tex, idx, pkg);
    if (scan.found) return true;
    if (scan.next === null) return false;
    from = scan.next;
  }
  return false;
}

function includesLiteral(tex: string, snippet: string): boolean {
  return tex.includes(snippet);
}

export function scanImportCompatibility(sources: {
  texFiles?: ReadonlyArray<{ path: string; content: string }>;
  latexmkrc?: string | null;
}): ImportCompatFinding[] {
  const findings: ImportCompatFinding[] = [];
  const texRaw = (sources.texFiles ?? []).map((f) => f.content).join("\n\n");
  const capped =
    texRaw.length > MAX_SCAN_CHARS ? texRaw.slice(0, MAX_SCAN_CHARS) : texRaw;
  const tex = stripLineComments(capped);
  const latexmkrc = sources.latexmkrc ?? "";

  const usesBiblatex =
    loadsPackage(tex, "biblatex") ||
    includesLiteral(tex, String.raw`\addbibresource{`) ||
    includesLiteral(tex, "backend=biber") ||
    latexmkrc.toLowerCase().includes("biber");

  if (usesBiblatex) {
    findings.push(findingFor("biblatex-biber"));
  }

  if (loadsPackage(tex, "minted") || includesLiteral(tex, String.raw`\begin{minted}`)) {
    findings.push(findingFor("minted"));
  }

  if (
    loadsPackage(tex, "glossaries") ||
    loadsPackage(tex, "imakeidx") ||
    loadsPackage(tex, "makeidx") ||
    includesLiteral(tex, String.raw`\makeglossaries`) ||
    includesLiteral(tex, String.raw`\printglossar`)
  ) {
    findings.push(findingFor("glossaries-index"));
  }

  if (loadsPackage(tex, "pythontex") || includesLiteral(tex, String.raw`\begin{pycode}`)) {
    findings.push(findingFor("pythontex"));
  }

  if (
    includesLiteral(tex, String.raw`\write18`) ||
    includesLiteral(tex, String.raw`\ShellEscape`) ||
    includesLiteral(tex, String.raw`\input{|`)
  ) {
    findings.push(findingFor("shell-escape"));
  }

  if (loadsPackage(tex, "fontspec") || includesLiteral(tex, String.raw`\setmainfont{`)) {
    findings.push(findingFor("fontspec"));
  }

  if (loadsPackage(tex, "CJKutf8") || loadsPackage(tex, "CJK")) {
    findings.push(findingFor("cjk-pdftex-package"));
  }

  if (
    loadsPackage(tex, "cmap") ||
    loadsPackage(tex, "inputenc") ||
    includesLiteral(tex, String.raw`\pdfliteral`)
  ) {
    findings.push(findingFor("pdftex-only"));
  }

  return findings;
}

const MAX_CLASSIFY_CHARS = 1024 * 1024;

function matchesMinted(log: string): boolean {
  return (
    log.includes("Package minted Error") ||
    log.includes("minted Error") ||
    log.includes("pygmentize")
  );
}

function matchesShellEscape(log: string): boolean {
  return (
    log.includes("-shell-escape") ||
    log.includes("shell escape is disabled") ||
    log.includes("Shell escape disabled") ||
    log.includes(String.raw`\write18 disabled`) ||
    log.includes("runsystem(")
  );
}

function matchesGlossaries(log: string): boolean {
  return (
    log.includes("Package glossaries") ||
    hasMissingFileWithExtension(log, [".gls.", ".glo.", ".ind.", ".idx.", ".acr."]) ||
    log.includes("makeglossaries")
  );
}

function matchesFontspec(log: string): boolean {
  return (
    log.includes("Package fontspec Error") ||
    (log.includes("cannot be found") && log.includes("font"))
  );
}

const PDF_PRIMITIVE_LOG_LINE = /^l\.\d+ .*\\pdf[a-z]+$/;

function stoppedOnPdfPrimitive(line: string, previous: string | undefined): boolean {
  return (
    previous?.trimEnd().endsWith("Undefined control sequence.") === true &&
    PDF_PRIMITIVE_LOG_LINE.test(line.trimEnd())
  );
}

// Journal classes (e.g. Springer's sn-jnl) hit pdfTeX-only internals under
// XeTeX: "Undefined control sequence" pointing at \pdf@... primitives.
// Real pdfLaTeX via latexmk is the fix, exactly like Overleaf.
function matchesPdftexOnly(log: string): boolean {
  if (!log.includes("Undefined control sequence")) return false;
  const primitives = [String.raw`\pdf@`, String.raw`\pdfliteral`, String.raw`\pdftexversion`, String.raw`\pdfpageattr`];
  const lines = log.split("\n");
  return lines.some(
    (line, index) =>
      (!line.startsWith("Package pdftexcmds Info:") &&
        primitives.some((primitive) => line.includes(primitive))) ||
      stoppedOnPdfPrimitive(line, lines[index - 1]),
  );
}

function collectPackageFindings(log: string): ImportCompatFinding[] {
  const findings: ImportCompatFinding[] = [];
  if (matchesMinted(log)) {
    findings.push(findingFor("minted"));
  }
  if (matchesShellEscape(log) && !findings.some((f) => f.id === "minted")) {
    findings.push(findingFor("shell-escape"));
  }
  if (matchesGlossaries(log)) {
    findings.push(findingFor("glossaries-index"));
  }
  if (log.includes("pythontex") || log.includes("PythonTeX")) {
    findings.push(findingFor("pythontex"));
  }
  if (log.includes("[Oleafly] Bibliography needs Biber")) {
    findings.push(findingFor("biblatex-biber"));
  }
  return findings;
}

function collectEngineFindings(log: string, findings: ImportCompatFinding[]): void {
  if (matchesFontspec(log)) {
    findings.push(findingFor("fontspec"));
  }
  if (matchesPdftexOnly(log)) {
    findings.push(findingFor("pdftex-only"));
  }
  if (hasWrongDriverOption(log, "pdftex")) {
    findings.push(findingFor("hyperref-pdftex-driver"));
  }
  const eps = epsImageFile(log);
  if (eps !== null) {
    findings.push(
      withDetail(
        findingFor("eps-image"),
        eps ? `The compile stopped on ${eps}.` : "",
        { file: eps },
      ),
    );
  }
}

function collectMissingFileFindings(log: string, findings: ImportCompatFinding[]): void {
  const missing = missingLatexFiles(log);
  if (missing.length === 0) return;
  findings.push(
    withDetail(
      findingFor("missing-sty-on-bundled-engine"),
      `The compile could not find ${missing.join(", ")}.`,
      { missing },
    ),
  );
}

export function classifyCompileFailure(
  logRaw: string,
  options: { bundledEngine?: boolean } = {},
): ImportCompatFinding[] {
  const log =
    logRaw.length > MAX_CLASSIFY_CHARS ? logRaw.slice(0, MAX_CLASSIFY_CHARS) : logRaw;

  const bundleStatus = bundleFetchStatus(log);
  if (bundleStatus !== null) {
    return [
      withDetail(
        findingFor("bundle-fetch-failed"),
        bundleStatus > 0 ? `The mirror returned HTTP ${bundleStatus}.` : "",
        { status: bundleStatus },
      ),
    ];
  }

  const findings = collectPackageFindings(log);
  collectEngineFindings(log, findings);
  if (options.bundledEngine !== false) {
    collectMissingFileFindings(log, findings);
  }
  return findings;
}

const OFFLINE_MISS_FINDINGS: ReadonlySet<string> = new Set([
  "missing-sty-on-bundled-engine",
  "bundle-fetch-failed",
  "fontspec",
]);

const OFFLINE_MISS_MARKERS = [
  'failed to open input file "tectonic-format-',
  "I did not find the tikz library",
];

export function offlineCacheMiss(
  log: string,
  findings: readonly ImportCompatFinding[],
): boolean {
  if (findings.length > 0) {
    return findings.every((finding) => OFFLINE_MISS_FINDINGS.has(finding.id));
  }
  return OFFLINE_MISS_MARKERS.some((marker) => log.includes(marker));
}

function withDetail(
  finding: ImportCompatFinding,
  sentence: string,
  params: ImportCompatFindingParams,
): ImportCompatFinding {
  return sentence ? { ...finding, detail: `${finding.detail} ${sentence}`, params } : finding;
}

const BUNDLE_FETCH_MARKERS = [
  "couldn't get it from the internet",
  "this bundle isn't cached",
  "unexpected http response code",
  "error connecting to",
  "connecting to",
  "failed to download",
];

const BUNDLE_CONTEXT_MARKERS = ["tex-bundles", "bundle"];
const NETWORK_FAILURE_MARKER = "please check your network connection";
const NETWORK_STATUS_LOOKBACK_LINES = 8;

function httpStatusIn(text: string): number {
  const marker = "unexpected http response code ";
  const at = text.toLowerCase().indexOf(marker);
  if (at === -1) return 0;
  const status = Number.parseInt(text.slice(at + marker.length, at + marker.length + 3), 10);
  return Number.isInteger(status) && status >= 100 && status <= 599 ? status : 0;
}

function networkFailureStatus(lines: readonly string[], index: number): number {
  const from = Math.max(0, index - NETWORK_STATUS_LOOKBACK_LINES);
  for (let at = index; at >= from; at -= 1) {
    const status = httpStatusIn(lines[at]);
    if (status > 0) return status;
  }
  return 0;
}

function bundleFetchStatus(log: string): number | null {
  const lines = log.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].toLowerCase();
    if (line.includes(NETWORK_FAILURE_MARKER)) return networkFailureStatus(lines, index);
    if (!BUNDLE_FETCH_MARKERS.some((marker) => line.includes(marker))) continue;
    const context = `${(lines[index - 1] ?? "").toLowerCase()}\n${line}`;
    if (!BUNDLE_CONTEXT_MARKERS.some((marker) => context.includes(marker))) continue;
    for (const candidate of [lines[index], lines[index + 1] ?? "", lines[index + 2] ?? ""]) {
      const status = httpStatusIn(candidate);
      if (status > 0) return status;
    }
    return 0;
  }
  return null;
}

function hasWrongDriverOption(log: string, driver: string): boolean {
  const marker = "Wrong driver option ";
  let from = 0;
  while (from < log.length) {
    const at = log.indexOf(marker, from);
    if (at === -1) return false;
    const eol = log.indexOf("\n", at);
    const line = log.slice(at, eol === -1 ? log.length : eol);
    if (line.includes(driver)) return true;
    from = at + marker.length;
  }
  return false;
}

const MAX_QUOTED_NAME = 256;

function failedImageInclusion(log: string): string | null {
  const marker = 'image inclusion failed for "';
  let from = 0;
  while (from < log.length) {
    const at = log.indexOf(marker, from);
    if (at === -1) return null;
    const start = at + marker.length;
    const end = log.indexOf('"', start);
    if (end !== -1 && end - start <= MAX_QUOTED_NAME) {
      const name = log.slice(start, end).trim();
      if (name.toLowerCase().endsWith(".eps")) return name;
    }
    from = start;
  }
  return null;
}

function unconvertedEpsImage(log: string): string | null {
  let mentioned = false;
  for (const quote of ["`", "'", '"']) {
    const suffix = `-eps-converted-to.pdf${quote === "`" ? "'" : quote} not found`;
    const at = log.indexOf(suffix);
    if (at === -1) continue;
    mentioned = true;
    const opening = log.lastIndexOf(quote, at);
    if (opening === -1 || at - opening > MAX_QUOTED_NAME) continue;
    const name = log.slice(opening + 1, at).trim();
    if (name && !/[\n`'"]/.test(name)) return `${name}.eps`;
  }
  return mentioned ? "" : null;
}

function epsImageFile(log: string): string | null {
  const included = failedImageInclusion(log);
  if (included !== null) return included;
  const unconverted = unconvertedEpsImage(log);
  if (unconverted !== null) return unconverted;
  if (log.includes("Shell escape feature is not enabled") && log.includes(".eps")) {
    return "";
  }
  return null;
}

const MISSING_FILE_EXTENSIONS: ReadonlySet<string> = new Set([
  "sty",
  "cls",
  "clo",
  "def",
  "fd",
  "ldf",
  "bbx",
  "cbx",
  "lbx",
  "bst",
  "tfm",
  "vf",
  "pfb",
  "otf",
  "ttf",
  "ttc",
]);
const TIKZ_LIBRARY_SUFFIX = ".code.tex";
const MAX_MISSING_FILES = 8;
const MAX_MARKED_LINES = 64;
const TEX_LOG_LINE_WIDTH = 79;
const LEGACY_ENCODED_FONT = /^! Font \\?(?!TU\/)[^/=\s]+\//;

function isMissingStyleFile(file: string): boolean {
  const dot = file.lastIndexOf(".");
  const ext = dot === -1 ? "" : file.slice(dot + 1).toLowerCase();
  if (!MISSING_FILE_EXTENSIONS.has(ext) && !file.toLowerCase().endsWith(TIKZ_LIBRARY_SUFFIX)) {
    return false;
  }
  return /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(file);
}

function missingFileAt(
  log: string,
  marker: string,
  idx: number,
): { file: string | null; next: number } {
  const start = idx + marker.length;
  const quote = log.indexOf(marker.endsWith('"') ? '"' : "'", start);
  if (quote === -1 || quote - start > 128) return { file: null, next: start };
  const file = log.slice(start, quote).trim();
  return { file: isMissingStyleFile(file) ? file : null, next: quote + 1 };
}

function textAfterMarker(log: string, marker: string): string[] {
  const lines: string[] = [];
  let from = 0;
  while (lines.length < MAX_MARKED_LINES) {
    const idx = log.indexOf(marker, from);
    if (idx === -1) break;
    const eol = log.indexOf("\n", idx);
    const end = eol === -1 ? log.length : eol;
    lines.push(log.slice(idx + marker.length, end).trimEnd());
    from = end;
  }
  return lines;
}

function firstWord(text: string): string {
  return text.split(/\s/, 1)[0] ?? "";
}

function quotedName(text: string): string {
  const end = text.search(/['`"]/);
  return end > 0 && end <= MAX_QUOTED_NAME ? text.slice(0, end) : "";
}

function latexmkBstFiles(log: string): string[] {
  const marker = "Latexmk: Bst file not found in search path:";
  const idx = log.indexOf(marker);
  if (idx === -1) return [];
  const files: string[] = [];
  const block = log.slice(idx + marker.length, idx + marker.length + MAX_QUOTED_NAME * 4);
  for (const line of block.split("\n").slice(1)) {
    if (!line.startsWith(" ")) break;
    const name = line.trim();
    files.push(name.endsWith(".bst") ? name : `${name}.bst`);
  }
  return files;
}

function bibliographyStyleFiles(log: string): string[] {
  const opened = textAfterMarker(log, "I couldn't open style file ").map(firstWord);
  return [...opened, ...latexmkBstFiles(log)];
}

function biblatexStyleFiles(log: string): string[] {
  if (!log.includes("Package biblatex Error: Style '")) return [];
  return textAfterMarker(log, "Package biblatex Info: ... file '")
    .filter((rest) => rest.endsWith("' not found."))
    .map(quotedName)
    .filter((name) => /\.[bc]bx$/.test(name));
}

function babelLanguageFiles(log: string): string[] {
  const options = ["Package babel Error: Unknown option '", "Package babel Error: Unknown option `"]
    .flatMap((marker) => textAfterMarker(log, marker))
    .map(quotedName)
    .filter((name) => name.length > 0)
    .map((name) => `${name}.ldf`);
  return [...options, ...textAfterMarker(log, "language definition file ").map(firstWord)];
}

function tikzLibraryFiles(log: string): string[] {
  return textAfterMarker(log, "I did not find the tikz library '")
    .map(quotedName)
    .filter((name) => name.length > 0)
    .map((name) => `tikzlibrary${name}${TIKZ_LIBRARY_SUFFIX}`);
}

function unwrappedLogLine(log: string, start: number): string {
  let text = "";
  let from = start;
  for (let piece = 0; piece < 4; piece += 1) {
    const eol = log.indexOf("\n", from);
    const line = log.slice(from, eol === -1 ? log.length : eol).replace(/\r$/, "");
    text += line;
    if (eol === -1 || line.length !== TEX_LOG_LINE_WIDTH) break;
    from = eol + 1;
  }
  return text;
}

function metricFontFile(line: string): string {
  const loadable = line.indexOf(" not loadable: Metric (TFM)");
  const equals = line.indexOf("=");
  if (loadable === -1 || equals === -1 || equals > loadable) return "";
  const spec = line.slice(equals + 1, loadable).split(/ (?:at|scaled) /, 1)[0] ?? "";
  if (spec.startsWith('"') || spec === "nullfont") return "";
  if (spec.startsWith("[")) return spec.slice(1, spec.indexOf("]"));
  const systemFontName = line.includes("or installed font") && !LEGACY_ENCODED_FONT.test(line);
  return systemFontName ? "" : `${spec}.tfm`;
}

function fontMetricFiles(log: string): string[] {
  const marker = "! Font ";
  const files: string[] = [];
  let from = 0;
  while (files.length < MAX_MISSING_FILES) {
    const idx = log.indexOf(marker, from);
    if (idx === -1) break;
    from = idx + marker.length;
    if (idx > 0 && log[idx - 1] !== "\n") continue;
    const file = metricFontFile(unwrappedLogLine(log, idx));
    if (file && !files.includes(file)) files.push(file);
  }
  return files;
}

function fontShapeFiles(log: string): string[] {
  return textAfterMarker(log, "Font shape `")
    .flatMap((rest) => {
      const close = rest.indexOf("'");
      if (close === -1 || !rest.slice(close).startsWith("' undefined")) return [];
      const [encoding, family] = rest.slice(0, close).split("/");
      return encoding && family ? [`${encoding}${family}.fd`.toLowerCase()] : [];
    })
    .filter((name) => !log.includes(`File: ${name} `));
}

function unreadableFontFiles(log: string): string[] {
  return textAfterMarker(log, "!pdfTeX error: ")
    .filter((rest) => rest.endsWith("font file for reading"))
    .flatMap((rest) => {
      const open = rest.indexOf("(file ");
      const close = rest.indexOf(")", open);
      return open === -1 || close === -1 ? [] : [rest.slice(open + 6, close).replace(/^\.\//, "")];
    });
}

function derivedMissingFiles(log: string): string[] {
  const fonts = fontMetricFiles(log);
  return [
    ...bibliographyStyleFiles(log),
    ...biblatexStyleFiles(log),
    ...babelLanguageFiles(log),
    ...tikzLibraryFiles(log),
    ...(fonts.length > 0 ? fontShapeFiles(log) : []),
    ...fonts,
    ...unreadableFontFiles(log),
  ];
}

export function missingLatexFiles(logRaw: string): string[] {
  const log =
    logRaw.length > MAX_CLASSIFY_CHARS ? logRaw.slice(0, MAX_CLASSIFY_CHARS) : logRaw;
  const found = new Set<string>();
  const markers = ["LaTeX Error: File `", "I can't find file `", "LaTeX Error: File '", 'LaTeX Error: File "'];
  for (const marker of markers) {
    let from = 0;
    while (from < log.length && found.size < MAX_MISSING_FILES) {
      const idx = log.indexOf(marker, from);
      if (idx === -1) break;
      const read = missingFileAt(log, marker, idx);
      if (read.file !== null) found.add(read.file);
      from = read.next;
    }
  }
  for (const file of derivedMissingFiles(log)) {
    if (found.size >= MAX_MISSING_FILES) break;
    if (isMissingStyleFile(file)) found.add(file);
  }
  return [...found];
}

/**
 * TeX reports a missing include as `No file <name><ext>` (with a trailing
 * period). Line-scan for that shape so ordinary mentions of the extension in
 * prose do not match.
 */
function hasMissingFileWithExtension(log: string, endings: string[]): boolean {
  let from = 0;
  while (from < log.length) {
    const idx = log.indexOf("No file ", from);
    if (idx === -1) return false;
    const eol = log.indexOf("\n", idx);
    const line = log.slice(idx, eol === -1 ? log.length : eol).trimEnd();
    if (endings.some((ending) => line.endsWith(ending) || line.endsWith(ending.slice(0, -1)))) {
      return true;
    }
    from = idx + 8;
  }
  return false;
}
