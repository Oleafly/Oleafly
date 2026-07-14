import { maskComments } from "./mask";
import type { Finding } from "./types";

export interface RefsContext {
  definedLabels: string[];
  bibKeys: string[];
  bibLoaded: boolean;
  projectFiles: string[];
  duplicateDois: { doi: string; keys: string[] }[];
}

const GRAPHICS_EXT = ["", ".pdf", ".png", ".jpg", ".jpeg", ".eps", ".svg"];
const INPUT_EXT = ["", ".tex"];

const CITE = /\\(?:cite|citep|citet|citeauthor|citeyear|citealt|parencite|textcite|autocite|nocite)\*?\s*(?:\[[^\]]*\])?\s*\{([^}]*)\}/g;
const REF = /\\(?:ref|eqref|autoref|cref|Cref|cpageref|pageref|vref|labelcref)\s*\{([^}]*)\}/g;
const LABEL = /\\label\s*\{([^}]*)\}/g;
const GRAPHICS = /\\includegraphics\s*(?:\[[^\]]*\])?\s*\{([^}]*)\}/g;
const INPUT = /\\(?:input|include)\s*\{([^}]*)\}/g;

function resolves(ref: string, files: string[], exts: string[]): boolean {
  const target = ref.trim().replace(/^\.\//, "");
  const base = target.split("/").pop() ?? target;
  for (const ext of exts) {
    const withExt = target + ext;
    const baseWithExt = base + ext;
    if (
      files.some(
        (f) => f === withExt || f.endsWith("/" + withExt) || f === baseWithExt || f.endsWith("/" + baseWithExt),
      )
    ) {
      return true;
    }
  }
  return false;
}

export function runRefsRules(rawSource: string, ctx: RefsContext): Finding[] {
  const out: Finding[] = [];
  let m: RegExpExecArray | null;
  // Blank out commented-out LaTeX so a commented `\cite`/`\ref`/`\label` does
  // not raise a false finding. Offsets are preserved (comments become spaces).
  const source = maskComments(rawSource);

  const labels = new Set(ctx.definedLabels.map((l) => l.trim()));
  const labelRe = new RegExp(LABEL.source, "g");
  while ((m = labelRe.exec(source))) labels.add(m[1].trim());

  const bibKeys = new Set(ctx.bibKeys.map((k) => k.trim()));

  if (ctx.bibLoaded) {
    const re = new RegExp(CITE.source, "g");
    while ((m = re.exec(source))) {
      const from = m.index;
      const to = m.index + m[0].length;
      for (const key of m[1].split(",").map((k) => k.trim())) {
        if (!key || key === "*") continue;
        if (!bibKeys.has(key)) {
          out.push({
            id: "refs-undefined-cite",
            lens: "refs",
            severity: "error",
            title: `Citation "${key}" is not in any .bib`,
            detail:
              "This citation key was not found in the loaded bibliography, so it will render as [?] in the PDF. Check the key, or add the entry to your .bib (Add citation can fetch it).",
            from,
            to,
          });
        }
      }
    }
  }

  const refRe = new RegExp(REF.source, "g");
  while ((m = refRe.exec(source))) {
    const from = m.index;
    const to = m.index + m[0].length;
    for (const label of m[1].split(",").map((l) => l.trim())) {
      if (!label) continue;
      if (!labels.has(label)) {
        out.push({
          id: "refs-undefined-ref",
          lens: "refs",
          severity: "error",
          title: `Reference to "${label}" has no matching \\label`,
          detail:
            "This cross-reference points to a label that is not defined, so it will render as ?? in the PDF. Check the label name, or add the missing \\label.",
          from,
          to,
        });
      }
    }
  }

  const seen = new Map<string, number>();
  const dupRe = new RegExp(LABEL.source, "g");
  while ((m = dupRe.exec(source))) {
    const key = m[1].trim();
    if (seen.has(key)) {
      out.push({
        id: "refs-duplicate-label",
        lens: "refs",
        severity: "warning",
        title: `Duplicate label "${key}"`,
        detail: "The same label is defined more than once, so references to it are ambiguous. Make each label unique.",
        from: m.index,
        to: m.index + m[0].length,
      });
    } else {
      seen.set(key, m.index);
    }
  }

  const gRe = new RegExp(GRAPHICS.source, "g");
  while ((m = gRe.exec(source))) {
    if (!resolves(m[1], ctx.projectFiles, GRAPHICS_EXT)) {
      out.push({
        id: "refs-missing-asset",
        lens: "refs",
        severity: "error",
        title: `Image not found: ${m[1].trim()}`,
        detail: "This \\includegraphics points to a file that is not in the project, so the figure will be missing. Check the filename and path.",
        from: m.index,
        to: m.index + m[0].length,
      });
    }
  }

  const iRe = new RegExp(INPUT.source, "g");
  while ((m = iRe.exec(source))) {
    if (!resolves(m[1], ctx.projectFiles, INPUT_EXT)) {
      out.push({
        id: "refs-missing-asset",
        lens: "refs",
        severity: "error",
        title: `Included file not found: ${m[1].trim()}`,
        detail: "This \\input or \\include points to a file that is not in the project. Check the filename and path.",
        from: m.index,
        to: m.index + m[0].length,
      });
    }
  }

  for (const dup of ctx.duplicateDois) {
    out.push({
      id: "refs-duplicate-bib",
      lens: "refs",
      severity: "warning",
      title: `Duplicate bibliography entries: ${dup.keys.join(", ")}`,
      detail: `These entries share the DOI ${dup.doi}, so they are the same reference under different keys. Keep one and cite it, or your bibliography will list it twice.`,
    });
  }

  return out.sort((a, b) => (a.from ?? 0) - (b.from ?? 0));
}
