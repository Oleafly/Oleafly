import {
  type BibliographyEngine,
  bibliographyCandidatePaths,
  bibliographyDeclarations,
  bibliographyDisplayName,
  bibliographyEngineForCommand,
  resolveBibliographyPath,
} from "@oleafly/latex";
import { maskComments } from "./mask";
import { message } from "./messages";
import type { Finding } from "./types";

export interface RefsContext {
  definedLabels: string[];
  bibKeys: string[];
  bibLoaded: boolean;
  projectFiles: string[];
  unresolvedBibliographies?: { file: string; name: string }[];
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
      title: message("rules.refs-incomplete-metadata.title", { count: incomplete.length }),
      detail: message(
        incomplete.length > 5
          ? "rules.refs-incomplete-metadata.detailTruncated"
          : "rules.refs-incomplete-metadata.detail",
        { examples },
      ),
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
      title: message("rules.refs-malformed-doi.title", { count: malformedDois.length }),
      detail: message("rules.refs-malformed-doi.detail", {
        keys: malformedDois.slice(0, 8).map((entry) => entry.key).join(", "),
      }),
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
      title: message("rules.refs-duplicate-title.title", { count: duplicateTitles.length }),
      detail: message("rules.refs-duplicate-title.detail", {
        groups: duplicateTitles.slice(0, 5).map((keys) => keys.join(" / ")).join("; "),
      }),
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
        title: message("rules.refs-uncited-entries.title", { count: uncited.length }),
        detail: message(
          uncited.length > 8
            ? "rules.refs-uncited-entries.detailTruncated"
            : "rules.refs-uncited-entries.detail",
          { keys: uncited.slice(0, 8).map((entry) => entry.key).join(", ") },
        ),
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
      title: message("rules.refs-project-duplicate-label.title", { count: duplicates.length }),
      detail: message("rules.refs-project-duplicate-label.detail", {
        labels: duplicates
          .slice(0, 6)
          .map((item) => `${item.label} (${item.files.join(", ")})`)
          .join("; "),
      }),
      certainty: "verified",
    });
  }
  const unreferenced = ctx.unreferencedLabels ?? [];
  if (unreferenced.length > 0) {
    out.push({
      id: "refs-unreferenced-floats",
      lens: "refs",
      severity: "info",
      title: message("rules.refs-unreferenced-floats.title", { count: unreferenced.length }),
      detail: message(
        unreferenced.length > 8
          ? "rules.refs-unreferenced-floats.detailTruncated"
          : "rules.refs-unreferenced-floats.detail",
        { labels: unreferenced.slice(0, 8).map((item) => item.label).join(", ") },
      ),
      certainty: "advisory",
    });
  }
  return out;
}

function resolvableFromAnyDirectory(
  rawTarget: string,
  projectFiles: string[],
  engine: BibliographyEngine,
): boolean {
  const spellings = bibliographyCandidatePaths(rawTarget, "", engine).map((spelling) =>
    spelling.toLowerCase(),
  );
  if (spellings.length === 0) return false;
  return projectFiles.some((file) => {
    const candidate = file.toLowerCase();
    return spellings.some(
      (spelling) => candidate === spelling || candidate.endsWith(`/${spelling}`),
    );
  });
}

function missingBibliography(
  rawTarget: string,
  ctx: RefsContext,
  fromFile: string | undefined,
  engine: BibliographyEngine,
): boolean {
  const unresolved = ctx.unresolvedBibliographies;
  if (unresolved) {
    if (fromFile !== undefined) {
      return unresolved.some(
        (declaration) => declaration.file === fromFile && declaration.name === rawTarget,
      );
    }
    return (
      unresolved.some((declaration) => declaration.name === rawTarget) &&
      !resolvableFromAnyDirectory(rawTarget, ctx.projectFiles, engine)
    );
  }
  if (ctx.projectFiles.length === 0) return false;
  return (
    resolveBibliographyPath(rawTarget, fromFile ?? "", ctx.projectFiles, engine) ===
    null
  );
}

export function runRefsRules(
  rawSource: string,
  ctx: RefsContext,
  options: { includeProjectQuality?: boolean; file?: string } = {},
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
            title: message("rules.refs-undefined-cite.title", { key }),
            detail: message("rules.refs-undefined-cite.detail"),
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
          title: message("rules.refs-undefined-ref.title", { label }),
          detail: message("rules.refs-undefined-ref.detail"),
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
        title: message("rules.refs-duplicate-label.title", { label: key }),
        detail: message("rules.refs-duplicate-label.detail"),
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
        title: message("rules.refs-missing-asset.titleImage", { file: m[1].trim() }),
        detail: message("rules.refs-missing-asset.detailImage"),
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
        title: message("rules.refs-missing-asset.titleInclude", { file: m[1].trim() }),
        detail: message("rules.refs-missing-asset.detailInclude"),
        from: m.index,
        to: m.index + m[0].length,
      });
    }
  }

  for (const declaration of bibliographyDeclarations(source)) {
    const engine = bibliographyEngineForCommand(declaration.command);
    if (!missingBibliography(declaration.raw, ctx, options.file, engine)) continue;
    out.push({
      id: "refs-bib-missing",
      lens: "refs",
      severity: "error",
      certainty: "verified",
      title: message("rules.refs-bib-missing.title", {
        file: bibliographyDisplayName(declaration.raw, engine),
      }),
      detail: message("rules.refs-bib-missing.detail"),
      from: declaration.from,
      to: declaration.to,
    });
  }

  for (const dup of ctx.duplicateDois) {
    out.push({
      id: "refs-duplicate-bib",
      lens: "refs",
      severity: "warning",
      title: message("rules.refs-duplicate-bib.title", { keys: dup.keys.join(", ") }),
      detail: message("rules.refs-duplicate-bib.detail", { doi: dup.doi }),
    });
  }

  if (options.includeProjectQuality !== false) {
    out.push(...bibliographyQuality(ctx), ...projectLabelQuality(ctx));
  }

  return out.sort((a, b) => (a.from ?? 0) - (b.from ?? 0));
}
