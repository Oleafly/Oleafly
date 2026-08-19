import { maskComments } from "./mask";
import type { Finding } from "./types";

export interface RefsContext {
  definedLabels: string[];
  bibKeys: string[];
  bibLoaded: boolean;
  projectFiles: string[];
  duplicateDois: { doi: string; keys: string[] }[];
  bibEntries?: { key: string; type: string; fields: Record<string, string> }[];
  allCitedKeys?: string[];
  duplicateLabels?: { label: string; files: string[] }[];
  unreferencedLabels?: { label: string; file: string }[];
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

function plain(value: string): string {
  return value
    .replace(/[{}\\]/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .toLowerCase();
}

function requiredFields(entry: NonNullable<RefsContext["bibEntries"]>[number]): string[] {
  const fields = entry.fields;
  const missing: string[] = [];
  const has = (name: string) => Boolean(fields[name]?.trim());
  if (!["misc", "online", "software", "dataset"].includes(entry.type) && !has("author") && !has("editor")) {
    missing.push("author/editor");
  }
  if (!has("title")) missing.push("title");
  if (!has("year") && !has("date")) missing.push("year/date");
  if (entry.type === "article" && !has("journal") && !has("journaltitle")) missing.push("journal");
  if (["inproceedings", "conference"].includes(entry.type) && !has("booktitle")) missing.push("booktitle");
  if (entry.type === "book" && !has("publisher")) missing.push("publisher");
  return missing;
}

function bibliographyQuality(ctx: RefsContext): Finding[] {
  const entries = ctx.bibEntries ?? [];
  if (entries.length === 0) return [];
  const out: Finding[] = [];

  const incomplete = entries
    .map((entry) => ({ key: entry.key, missing: requiredFields(entry) }))
    .filter((entry) => entry.missing.length > 0);
  if (incomplete.length > 0) {
    const examples = incomplete.slice(0, 5).map((entry) => `${entry.key}: ${entry.missing.join(", ")}`).join("; ");
    out.push({
      id: "refs-incomplete-metadata",
      lens: "refs",
      severity: "warning",
      title: `${incomplete.length} bibliography entr${incomplete.length === 1 ? "y has" : "ies have"} incomplete metadata`,
      detail: `Incomplete records can produce broken or ambiguous references in publisher styles. ${examples}${incomplete.length > 5 ? "; …" : "."}`,
      certainty: "verified",
    });
  }

  const malformedDois = entries.filter((entry) => {
    const raw = entry.fields.doi?.trim();
    if (!raw) return false;
    const doi = raw.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "");
    return !/^10\.\d{4,9}\/\S+$/i.test(doi);
  });
  if (malformedDois.length > 0) {
    out.push({
      id: "refs-malformed-doi",
      lens: "refs",
      severity: "warning",
      title: `${malformedDois.length} DOI value${malformedDois.length === 1 ? " looks" : "s look"} malformed`,
      detail: `Review the DOI fields for ${malformedDois.slice(0, 8).map((entry) => entry.key).join(", ")}. Store only the DOI identifier, for example 10.1000/example, rather than descriptive text.`,
      certainty: "verified",
    });
  }

  const titleMap = new Map<string, string[]>();
  for (const entry of entries) {
    const title = plain(entry.fields.title ?? "");
    if (title.length < 16) continue;
    titleMap.set(title, [...(titleMap.get(title) ?? []), entry.key]);
  }
  const duplicateTitles = [...titleMap.values()].filter((keys) => keys.length > 1);
  if (duplicateTitles.length > 0) {
    out.push({
      id: "refs-duplicate-title",
      lens: "refs",
      severity: "warning",
      title: `${duplicateTitles.length} possible duplicate reference${duplicateTitles.length === 1 ? "" : " groups"}`,
      detail: `These keys have the same normalized title: ${duplicateTitles.slice(0, 5).map((keys) => keys.join(" / ")).join("; ")}. Merge true duplicates so citation style and metadata stay consistent.`,
      certainty: "verified",
    });
  }

  if (ctx.allCitedKeys && !ctx.allCitedKeys.includes("*")) {
    const cited = new Set(ctx.allCitedKeys);
    const uncited = entries.filter((entry) => !["xdata", "string", "preamble", "comment"].includes(entry.type) && !cited.has(entry.key));
    if (uncited.length > 0) {
      out.push({
        id: "refs-uncited-entries",
        lens: "refs",
        severity: "info",
        title: `${uncited.length} uncited bibliography entr${uncited.length === 1 ? "y" : "ies"}`,
        detail: `Unused entries add noise to submission metadata and make duplicate management harder. Review ${uncited.slice(0, 8).map((entry) => entry.key).join(", ")}${uncited.length > 8 ? ", …" : "."}`,
        certainty: "verified",
      });
    }
  }
  return out;
}

function projectLabelQuality(ctx: RefsContext): Finding[] {
  const out: Finding[] = [];
  const duplicates = ctx.duplicateLabels ?? [];
  if (duplicates.length > 0) {
    out.push({
      id: "refs-project-duplicate-label",
      lens: "refs",
      severity: "error",
      title: `${duplicates.length} label${duplicates.length === 1 ? " is" : "s are"} defined in multiple files`,
      detail: duplicates
        .slice(0, 6)
        .map((item) => `${item.label} (${item.files.join(", ")})`)
        .join("; "),
      certainty: "verified",
    });
  }
  const unreferenced = ctx.unreferencedLabels ?? [];
  if (unreferenced.length > 0) {
    out.push({
      id: "refs-unreferenced-floats",
      lens: "refs",
      severity: "info",
      title: `${unreferenced.length} figure, table, or equation label${unreferenced.length === 1 ? " is" : "s are"} never referenced`,
      detail: `Confirm that each numbered result is discussed in the manuscript: ${unreferenced.slice(0, 8).map((item) => item.label).join(", ")}${unreferenced.length > 8 ? ", …" : "."}`,
      certainty: "advisory",
    });
  }
  return out;
}

export function runRefsRules(
  rawSource: string,
  ctx: RefsContext,
  options: { includeProjectQuality?: boolean } = {},
): Finding[] {
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

  if (options.includeProjectQuality !== false) {
    out.push(...bibliographyQuality(ctx), ...projectLabelQuality(ctx));
  }

  return out.sort((a, b) => (a.from ?? 0) - (b.from ?? 0));
}
