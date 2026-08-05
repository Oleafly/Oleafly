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
    findings.push({
      id: "biblatex-biber",
      level: "warning",
      title: "Bibliography uses biblatex / Biber",
      detail:
        "This project needs Biber to build the reference list. Oleafly ships a pinned tectonic-biber matched to its Tectonic engine. If citations stay as “?” after compile, check the log for a Biber note.",
    });
  }

  if (loadsPackage(tex, "minted") || includesLiteral(tex, "\\begin{minted}")) {
    findings.push({
      id: "minted",
      level: "blocker",
      title: "minted needs shell-escape and Pygments",
      detail:
        "Code listings via minted require \\write18 and a system pygmentize. Oleafly does not enable shell-escape by default; expect failures until that toolchain is available.",
    });
  }

  if (
    loadsPackage(tex, "glossaries") ||
    loadsPackage(tex, "imakeidx") ||
    loadsPackage(tex, "makeidx") ||
    includesLiteral(tex, "\\makeglossaries") ||
    includesLiteral(tex, "\\printglossar")
  ) {
    findings.push({
      id: "glossaries-index",
      level: "blocker",
      title: "Glossary / index external tool",
      detail:
        "glossaries or makeindex need an external index run (makeindex/xindy), which is not yet orchestrated by Oleafly.",
    });
  }

  if (loadsPackage(tex, "pythontex") || includesLiteral(tex, "\\begin{pycode}")) {
    findings.push({
      id: "pythontex",
      level: "blocker",
      title: "pythontex",
      detail:
        "pythontex needs a Python helper pass outside the core Tectonic compile loop.",
    });
  }

  if (
    includesLiteral(tex, "\\write18") ||
    includesLiteral(tex, "\\ShellEscape") ||
    includesLiteral(tex, "\\input{|")
  ) {
    findings.push({
      id: "shell-escape",
      level: "warning",
      title: "Shell-escape commands",
      detail:
        "The source uses \\write18 / shell escapes. These are disabled by default for safety and often fail when host tools are missing.",
    });
  }

  if (loadsPackage(tex, "fontspec") || includesLiteral(tex, "\\setmainfont{")) {
    findings.push({
      id: "fontspec",
      level: "info",
      title: "Custom fonts (fontspec)",
      detail:
        "fontspec needs the named fonts installed on this machine. Overleaf often ships fonts that are not present locally.",
    });
  }

  if (
    loadsPackage(tex, "cmap") ||
    loadsPackage(tex, "inputenc") ||
    includesLiteral(tex, "\\pdfoutput") ||
    includesLiteral(tex, "\\pdfliteral")
  ) {
    findings.push({
      id: "pdftex-only",
      level: "info",
      title: "pdfTeX-oriented packages",
      detail:
        "Oleafly’s default engine is Tectonic (XeTeX-class). Some pdfTeX-only packages or primitives may need small source adjustments.",
    });
  }

  return findings;
}
