/**
 * Lightweight static scan of LaTeX sources for Overleaf-style requirements
 * that need extra tools beyond a single Tectonic typesetting pass.
 *
 * Matching is linear-time (indexOf / fixed-window scans) so adversarial
 * project text cannot trigger ReDoS. Input is capped before scanning.
 */

export type ImportCompatLevel = "info" | "warning" | "blocker";

export type ImportCompatAction =
  | "switch-to-latexmk"
  | "switch-to-pdflatex"
  | "install-after-switch"
  | "retry-compile";

export type ImportCompatFinding = {
  id: string;
  level: ImportCompatLevel;
  title: string;
  detail: string;
};

/**
 * Single source of truth for the Tectonic-gap taxonomy. The import scan, the
 * compile-failure classifier, the engine-picker modal, and the Settings info
 * popovers all derive their copy from here so they can never disagree.
 *
 * `latexmkFixes`: whether switching the project to the latexmk engine (system
 * TeX) resolves this class of finding.
 */
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
      "glossaries or makeindex need an external index run (makeindex/xindy), which is not yet orchestrated by Oleafly.",
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
      "The source uses \\write18 or another shell escape. Switch to system LaTeX, then allow external commands on this computer only if you trust every project file and the required host tools are installed.",
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

/** Public lookup for one taxonomy entry (used by catch-all failure checks). */
export function importCompatFinding(id: ImportCompatFindingId): ImportCompatFinding {
  return findingFor(id);
}

/** True when switching to the latexmk engine resolves this finding. */
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

/** Cap combined TeX size so import scan stays cheap and predictable. */
const MAX_SCAN_CHARS = 512 * 1024;

/** True if `tex[i]` starts a TeX line comment (`%` not escaped by `\`). */
function isCommentPercent(tex: string, i: number): boolean {
  if (tex[i] !== "%") return false;
  let backslashes = 0;
  for (let j = i - 1; j >= 0 && tex[j] === "\\"; j -= 1) backslashes += 1;
  return backslashes % 2 === 0;
}

/**
 * Drop line comments (`%` … EOL) so commented-out `\usepackage{…}` does not
 * produce false-positive import toasts. Linear scan; leaves `\%` alone.
 */
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

/**
 * True if `\usepackage[...]{...}` (or without options) loads a package whose
 * name equals `pkg` or appears in a comma-separated package list.
 * Scans with indexOf only — no nested quantifiers.
 */
export function loadsPackage(tex: string, pkg: string): boolean {
  const needle = "\\usepackage";
  let from = 0;
  while (from < tex.length) {
    const idx = tex.indexOf(needle, from);
    if (idx === -1) return false;
    let j = idx + needle.length;
    while (j < tex.length && (tex[j] === " " || tex[j] === "\t")) j += 1;
    if (tex[j] === "[") {
      const closeOpt = tex.indexOf("]", j + 1);
      if (closeOpt === -1) {
        from = idx + 1;
        continue;
      }
      // Optional args can contain backend=biber etc.
      const opts = tex.slice(j + 1, closeOpt);
      if (pkg === "biber" && opts.includes("backend=biber")) return true;
      j = closeOpt + 1;
      while (j < tex.length && (tex[j] === " " || tex[j] === "\t")) j += 1;
    }
    if (tex[j] !== "{") {
      from = idx + 1;
      continue;
    }
    const close = tex.indexOf("}", j + 1);
    if (close === -1) return false;
    const list = tex.slice(j + 1, close);
    for (const part of list.split(",")) {
      if (part.trim() === pkg) return true;
    }
    from = close + 1;
  }
  return false;
}

function includesLiteral(tex: string, snippet: string): boolean {
  return tex.includes(snippet);
}

/**
 * Scan concatenated project TeX (and optional latexmkrc) for known import gaps.
 * Pure and synchronous — safe to call from the editor or compile UI.
 */
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
    includesLiteral(tex, "\\addbibresource{") ||
    includesLiteral(tex, "backend=biber") ||
    latexmkrc.toLowerCase().includes("biber");

  if (usesBiblatex) {
    findings.push(findingFor("biblatex-biber"));
  }

  if (loadsPackage(tex, "minted") || includesLiteral(tex, "\\begin{minted}")) {
    findings.push(findingFor("minted"));
  }

  if (
    loadsPackage(tex, "glossaries") ||
    loadsPackage(tex, "imakeidx") ||
    loadsPackage(tex, "makeidx") ||
    includesLiteral(tex, "\\makeglossaries") ||
    includesLiteral(tex, "\\printglossar")
  ) {
    findings.push(findingFor("glossaries-index"));
  }

  if (loadsPackage(tex, "pythontex") || includesLiteral(tex, "\\begin{pycode}")) {
    findings.push(findingFor("pythontex"));
  }

  if (
    includesLiteral(tex, "\\write18") ||
    includesLiteral(tex, "\\ShellEscape") ||
    includesLiteral(tex, "\\input{|")
  ) {
    findings.push(findingFor("shell-escape"));
  }

  if (loadsPackage(tex, "fontspec") || includesLiteral(tex, "\\setmainfont{")) {
    findings.push(findingFor("fontspec"));
  }

  if (
    loadsPackage(tex, "cmap") ||
    loadsPackage(tex, "inputenc") ||
    includesLiteral(tex, "\\pdfoutput") ||
    includesLiteral(tex, "\\pdfliteral")
  ) {
    findings.push(findingFor("pdftex-only"));
  }

  return findings;
}

/** Cap classified log size the same way the scan caps source size. */
const MAX_CLASSIFY_CHARS = 1024 * 1024;

/**
 * Match a failed Tectonic compile log against known Tectonic-gap signatures.
 * Returns the same taxonomy entries as `scanImportCompatibility`, so the
 * compile-failure modal and the import toast tell one consistent story.
 * Plain `includes` scans only — logs are attacker-influenced text.
 */
export function classifyCompileFailure(
  logRaw: string,
  options: { bundledEngine?: boolean } = {},
): ImportCompatFinding[] {
  const log =
    logRaw.length > MAX_CLASSIFY_CHARS ? logRaw.slice(0, MAX_CLASSIFY_CHARS) : logRaw;
  const findings: ImportCompatFinding[] = [];
  const bundledEngine = options.bundledEngine !== false;

  const bundleStatus = bundleFetchStatus(log);
  if (bundleStatus !== null) {
    return [
      withDetail(
        findingFor("bundle-fetch-failed"),
        bundleStatus > 0 ? `The mirror returned HTTP ${bundleStatus}.` : "",
      ),
    ];
  }

  if (
    log.includes("Package minted Error") ||
    log.includes("minted Error") ||
    log.includes("pygmentize")
  ) {
    findings.push(findingFor("minted"));
  }

  if (
    log.includes("-shell-escape") ||
    log.includes("shell escape is disabled") ||
    log.includes("Shell escape disabled") ||
    log.includes("\\write18 disabled") ||
    log.includes("runsystem(")
  ) {
    if (!findings.some((f) => f.id === "minted")) {
      findings.push(findingFor("shell-escape"));
    }
  }

  if (
    log.includes("Package glossaries") ||
    hasMissingFileWithExtension(log, [".gls.", ".glo.", ".ind.", ".idx.", ".acr."]) ||
    log.includes("makeglossaries")
  ) {
    findings.push(findingFor("glossaries-index"));
  }

  if (log.includes("pythontex") || log.includes("PythonTeX")) {
    findings.push(findingFor("pythontex"));
  }

  // Appended by the Rust compile layer only when the pinned Biber pass could
  // not produce a usable .bbl — the case a full latexmk toolchain resolves.
  if (log.includes("[Oleafly] Bibliography needs Biber")) {
    findings.push(findingFor("biblatex-biber"));
  }

  if (
    log.includes("Package fontspec Error") ||
    log.includes("cannot be found") && log.includes("font")
  ) {
    findings.push(findingFor("fontspec"));
  }

  // Journal classes (e.g. Springer's sn-jnl) hit pdfTeX-only internals under
  // XeTeX: "Undefined control sequence" pointing at \pdf@... primitives.
  // Real pdfLaTeX via latexmk is the fix, exactly like Overleaf.
  if (
    log.includes("Undefined control sequence") &&
    ["\\pdf@", "\\pdfoutput", "\\pdfliteral", "\\pdftexversion", "\\pdfpageattr"].some(
      (primitive) => log.includes(primitive),
    )
  ) {
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
      ),
    );
  }

  if (bundledEngine) {
    const missing = missingLatexFiles(log);
    if (missing.length > 0) {
      findings.push(
        withDetail(
          findingFor("missing-sty-on-bundled-engine"),
          `The compile could not find ${missing.join(", ")}.`,
        ),
      );
    }
  }

  return findings;
}

function withDetail(finding: ImportCompatFinding, sentence: string): ImportCompatFinding {
  return sentence ? { ...finding, detail: `${finding.detail} ${sentence}` } : finding;
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

function httpStatusIn(text: string): number {
  const marker = "unexpected http response code ";
  const at = text.toLowerCase().indexOf(marker);
  if (at === -1) return 0;
  const status = Number.parseInt(text.slice(at + marker.length, at + marker.length + 3), 10);
  return Number.isInteger(status) && status >= 100 && status <= 599 ? status : 0;
}

function bundleFetchStatus(log: string): number | null {
  const lines = log.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].toLowerCase();
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
  for (const quote of ["`", "'", '"']) {
    const suffix = `-eps-converted-to.pdf${quote === "`" ? "'" : quote} not found`;
    const at = log.indexOf(suffix);
    if (at === -1) continue;
    const opening = log.lastIndexOf(quote, at);
    if (opening === -1 || at - opening > MAX_QUOTED_NAME) return "";
    const name = log.slice(opening + 1, at).trim();
    return name ? `${name}.eps` : "";
  }
  return null;
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

export function missingLatexFiles(logRaw: string): string[] {
  const log =
    logRaw.length > MAX_CLASSIFY_CHARS ? logRaw.slice(0, MAX_CLASSIFY_CHARS) : logRaw;
  const found = new Set<string>();
  const markers = ["LaTeX Error: File `", "I can't find file `", "LaTeX Error: File '", 'LaTeX Error: File "'];
  for (const marker of markers) {
    let from = 0;
    while (from < log.length && found.size < 8) {
      const idx = log.indexOf(marker, from);
      if (idx === -1) break;
      const start = idx + marker.length;
      const quote = log.indexOf(marker.endsWith('"') ? '"' : "'", start);
      if (quote === -1 || quote - start > 128) {
        from = start;
        continue;
      }
      const file = log.slice(start, quote).trim();
      const dot = file.lastIndexOf(".");
      const ext = dot === -1 ? "" : file.slice(dot + 1).toLowerCase();
      if (ext === "sty" || ext === "cls") {
        if (/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(file)) found.add(file);
      }
      from = quote + 1;
    }
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
