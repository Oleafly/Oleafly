/**
 * Lightweight static scan of LaTeX sources for Overleaf-style requirements
 * that need extra tools beyond a single Tectonic typesetting pass.
 *
 * Matching is linear-time (indexOf / fixed-window scans) so adversarial
 * project text cannot trigger ReDoS. Input is capped before scanning.
 */

export type ImportCompatLevel = "info" | "warning" | "blocker";

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
    level: "warning",
    title: "Bibliography uses biblatex / Biber",
    detail:
      "This project needs Biber to build the reference list. Oleafly ships a pinned tectonic-biber matched to its Tectonic engine. If citations stay as “?” after compile, check the log for a Biber note.",
    latexmkFixes: true,
  },
  minted: {
    level: "blocker",
    title: "minted needs shell-escape and Pygments",
    detail:
      "Code listings via minted require \\write18 and a system pygmentize. Oleafly does not enable shell-escape by default; expect failures until that toolchain is available.",
    latexmkFixes: true,
  },
  "glossaries-index": {
    level: "blocker",
    title: "Glossary / index external tool",
    detail:
      "glossaries or makeindex need an external index run (makeindex/xindy), which is not yet orchestrated by Oleafly.",
    latexmkFixes: true,
  },
  pythontex: {
    level: "blocker",
    title: "pythontex",
    detail:
      "pythontex needs a Python helper pass outside the core Tectonic compile loop.",
    latexmkFixes: true,
  },
  "shell-escape": {
    level: "warning",
    title: "Shell-escape commands",
    detail:
      "The source uses \\write18 / shell escapes. These are disabled by default for safety and often fail when host tools are missing.",
    latexmkFixes: true,
  },
  fontspec: {
    level: "info",
    title: "Custom fonts (fontspec)",
    detail:
      "fontspec needs the named fonts installed on this machine. Overleaf often ships fonts that are not present locally.",
    latexmkFixes: false,
  },
  "pdftex-only": {
    level: "info",
    title: "pdfTeX-oriented packages",
    detail:
      "Oleafly’s default engine is Tectonic (XeTeX-class), and this project relies on pdfTeX-only packages or primitives. The latexmk engine compiles with real pdfLaTeX, the same way Overleaf does.",
    latexmkFixes: true,
  },
} as const satisfies Record<
  string,
  { level: ImportCompatLevel; title: string; detail: string; latexmkFixes: boolean }
>;

export type ImportCompatFindingId = keyof typeof IMPORT_COMPAT_CATALOG;

function findingFor(id: ImportCompatFindingId): ImportCompatFinding {
  const entry = IMPORT_COMPAT_CATALOG[id];
  return { id, level: entry.level, title: entry.title, detail: entry.detail };
}

/** True when switching to the latexmk engine resolves this finding. */
export function latexmkFixesFinding(id: string): boolean {
  return id in IMPORT_COMPAT_CATALOG
    ? IMPORT_COMPAT_CATALOG[id as ImportCompatFindingId].latexmkFixes
    : false;
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
export function classifyCompileFailure(logRaw: string): ImportCompatFinding[] {
  const log =
    logRaw.length > MAX_CLASSIFY_CHARS ? logRaw.slice(0, MAX_CLASSIFY_CHARS) : logRaw;
  const findings: ImportCompatFinding[] = [];

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

  return findings;
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
