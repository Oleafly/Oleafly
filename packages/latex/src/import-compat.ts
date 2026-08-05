/**
 * Lightweight static scan of LaTeX sources for Overleaf-style requirements
 * that need extra tools beyond a single Tectonic typesetting pass.
 */

export type ImportCompatLevel = "info" | "warning" | "blocker";

export type ImportCompatFinding = {
  id: string;
  level: ImportCompatLevel;
  title: string;
  detail: string;
};

const BIBLATEX =
  /\\usepackage(?:\[[^\]]*\])?\{[^}]*biblatex[^}]*\}|\\addbibresource\s*\{/;
const BIBER_BACKEND = /backend\s*=\s*biber|\\usepackage\[[^\]]*backend\s*=\s*biber/;
const MINTED = /\\usepackage(?:\[[^\]]*\])?\{[^}]*minted[^}]*\}|\\begin\{minted\}/;
const GLOSSARIES =
  /\\usepackage(?:\[[^\]]*\])?\{[^}]*(?:glossaries|imakeidx|makeidx)[^}]*\}|\\makeglossaries|\\printglossar/;
const PYTHONTEX = /\\usepackage(?:\[[^\]]*\])?\{[^}]*pythontex[^}]*\}|\\begin\{pycode\}/;
const SHELL_ESCAPE = /\\write18|\\ShellEscape|\\input\{\|/;
const FONTSPEC = /\\usepackage(?:\[[^\]]*\])?\{[^}]*fontspec[^}]*\}|\\setmainfont\s*\{/;
const PDFTEX_ONLY =
  /\\usepackage(?:\[[^\]]*\])?\{[^}]*(?:cmap|inputenc)[^}]*\}|\\pdfoutput|\\pdfliteral/;

/**
 * Scan concatenated project TeX (and optional latexmkrc) for known import gaps.
 * Pure and synchronous — safe to call from the editor or compile UI.
 */
export function scanImportCompatibility(sources: {
  texFiles?: ReadonlyArray<{ path: string; content: string }>;
  latexmkrc?: string | null;
}): ImportCompatFinding[] {
  const findings: ImportCompatFinding[] = [];
  const tex = (sources.texFiles ?? [])
    .map((f) => f.content)
    .join("\n\n");
  const latexmkrc = sources.latexmkrc ?? "";

  if (BIBLATEX.test(tex) || BIBER_BACKEND.test(tex) || /biber/i.test(latexmkrc)) {
    findings.push({
      id: "biblatex-biber",
      level: "warning",
      title: "Bibliography uses biblatex / Biber",
      detail:
        "This project needs Biber to build the reference list. Oleafly ships a pinned tectonic-biber matched to its Tectonic engine. If citations stay as “?” after compile, check the log for a Biber note.",
    });
  }

  if (MINTED.test(tex)) {
    findings.push({
      id: "minted",
      level: "blocker",
      title: "minted needs shell-escape and Pygments",
      detail:
        "Code listings via minted require \\write18 and a system pygmentize. Oleafly does not enable shell-escape by default; expect failures until that toolchain is available.",
    });
  }

  if (GLOSSARIES.test(tex)) {
    findings.push({
      id: "glossaries-index",
      level: "blocker",
      title: "Glossary / index external tool",
      detail:
        "glossaries or makeindex need an external index run (makeindex/xindy), which is not yet orchestrated by Oleafly.",
    });
  }

  if (PYTHONTEX.test(tex)) {
    findings.push({
      id: "pythontex",
      level: "blocker",
      title: "pythontex",
      detail:
        "pythontex needs a Python helper pass outside the core Tectonic compile loop.",
    });
  }

  if (SHELL_ESCAPE.test(tex)) {
    findings.push({
      id: "shell-escape",
      level: "warning",
      title: "Shell-escape commands",
      detail:
        "The source uses \\write18 / shell escapes. These are disabled by default for safety and often fail when host tools are missing.",
    });
  }

  if (FONTSPEC.test(tex)) {
    findings.push({
      id: "fontspec",
      level: "info",
      title: "Custom fonts (fontspec)",
      detail:
        "fontspec needs the named fonts installed on this machine. Overleaf often ships fonts that are not present locally.",
    });
  }

  if (PDFTEX_ONLY.test(tex)) {
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
