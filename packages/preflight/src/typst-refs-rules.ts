import { message } from "./messages";
import { bibliographyQuality, duplicateDoiFindings, projectLabelQuality, type RefsContext } from "./refs-rules";
import {
  type TypstPathReference,
  typstAtReferences,
  typstCiteCalls,
  typstHasBibliography,
  typstLabels,
  typstPathReferences,
  typstRefCalls,
} from "./typst-references";
import { type TypstScan, isExternalTypstPath, resolveTypstPath, scanTypst } from "./typst-scan";
import type { Finding } from "./types";

export interface TypstSourceFile {
  readonly path?: string;
  readonly content: string;
}

interface ScannedSource {
  readonly path?: string;
  readonly scan: TypstScan;
}

interface BibliographyState {
  readonly declared: boolean;
  readonly loaded: boolean;
  readonly missing: ReadonlySet<string>;
}

export function projectPathExists(files: readonly string[], fromFile: string | undefined, raw: string): boolean {
  if (isExternalTypstPath(raw)) return true;
  const resolved = resolveTypstPath(fromFile, raw);
  if (resolved === null) return false;
  const lower = resolved.toLowerCase();
  return files.some((file) => file.toLowerCase() === lower);
}

function referenceKey(path: string | undefined, reference: TypstPathReference): string {
  return `${path ?? ""}\0${reference.from}`;
}

function bibliographyState(sources: readonly ScannedSource[], files: readonly string[]): BibliographyState {
  const declared = sources.some((source) => typstHasBibliography(source.scan));
  const missing = new Set<string>();
  if (files.length > 0) {
    for (const source of sources) {
      for (const reference of typstPathReferences(source.scan)) {
        if (reference.kind === "bibliography" && !projectPathExists(files, source.path, reference.raw)) {
          missing.add(referenceKey(source.path, reference));
        }
      }
    }
  }
  return { declared, loaded: declared && missing.size === 0, missing };
}

function citationsCheckable(bibliography: BibliographyState, bibKeys: ReadonlySet<string>): boolean {
  return bibliography.loaded && bibKeys.size > 0;
}

function withFile(finding: Finding, path: string | undefined): Finding {
  return path ? { ...finding, file: path } : finding;
}

function resolvesAsLabel(name: string, labels: ReadonlySet<string>): boolean {
  if (labels.has(name)) return true;
  const colon = name.indexOf(":");
  return colon > 0 && labels.has(name.slice(colon + 1));
}

function importsPackage(sources: readonly ScannedSource[]): boolean {
  return sources.some((source) => /#import\s+"@[^"\n]+"/.test(source.scan.masked));
}

interface ReferenceTally {
  readonly cited: Set<string>;
  citations: number;
}

function referenceFindings(
  source: ScannedSource,
  labels: ReadonlySet<string>,
  bibKeys: ReadonlySet<string>,
  bibliography: BibliographyState,
  tally: ReferenceTally,
  packages: boolean,
): Finding[] {
  const out: Finding[] = [];
  for (const use of [...typstAtReferences(source.scan), ...typstRefCalls(source.scan)]) {
    if (resolvesAsLabel(use.name, labels)) continue;
    if (bibKeys.has(use.name)) {
      tally.cited.add(use.name);
      tally.citations++;
      continue;
    }
    if (!citationsCheckable(bibliography, bibKeys) && bibliography.declared) continue;
    out.push({
      id: "refs-undefined-ref",
      lens: "refs",
      severity: packages ? "warning" : "error",
      title: message("rules.refs-undefined-ref.titleTypst", { label: use.name }),
      detail: message(packages ? "rules.refs-undefined-ref.detailTypstPackage" : "rules.refs-undefined-ref.detailTypst"),
      from: use.from,
      to: use.to,
      ...(packages ? { certainty: "advisory" as const } : {}),
    });
  }
  for (const use of typstCiteCalls(source.scan)) {
    tally.citations++;
    if (bibKeys.has(use.name)) {
      tally.cited.add(use.name);
      continue;
    }
    if (!citationsCheckable(bibliography, bibKeys)) continue;
    out.push({
      id: "refs-undefined-cite",
      lens: "refs",
      severity: "error",
      title: message("rules.refs-undefined-cite.titleTypst", { key: use.name }),
      detail: message("rules.refs-undefined-cite.detailTypst"),
      from: use.from,
      to: use.to,
    });
  }
  return out;
}

function duplicateLabelFindings(scan: TypstScan): Finding[] {
  const seen = new Set<string>();
  const out: Finding[] = [];
  for (const label of typstLabels(scan)) {
    if (!seen.has(label.name)) {
      seen.add(label.name);
      continue;
    }
    out.push({
      id: "refs-duplicate-label",
      lens: "refs",
      severity: "warning",
      title: message("rules.refs-duplicate-label.title", { label: label.name }),
      detail: message("rules.refs-duplicate-label.detail"),
      from: label.from,
      to: label.to,
    });
  }
  return out;
}

function assetFindings(source: ScannedSource, files: readonly string[], bibliography: BibliographyState): Finding[] {
  if (files.length === 0) return [];
  const out: Finding[] = [];
  for (const reference of typstPathReferences(source.scan)) {
    if (reference.kind === "bibliography") {
      if (!bibliography.missing.has(referenceKey(source.path, reference))) continue;
      out.push({
        id: "refs-bib-missing",
        lens: "refs",
        severity: "error",
        certainty: "verified",
        title: message("rules.refs-bib-missing.title", { file: reference.raw }),
        detail: message("rules.refs-bib-missing.detailTypst"),
        from: reference.callFrom,
        to: reference.callTo,
      });
      continue;
    }
    if (reference.kind === "data" || projectPathExists(files, source.path, reference.raw)) continue;
    const image = reference.kind === "image";
    out.push({
      id: "refs-missing-asset",
      lens: "refs",
      severity: "error",
      title: message(image ? "rules.refs-missing-asset.titleImage" : "rules.refs-missing-asset.titleInclude", {
        file: reference.raw,
      }),
      detail: message(
        image ? "rules.refs-missing-asset.detailImageTypst" : "rules.refs-missing-asset.detailIncludeTypst",
      ),
      from: reference.callFrom,
      to: reference.callTo,
    });
  }
  return out;
}

export function runTypstRefsRules(sources: readonly TypstSourceFile[], ctx: RefsContext): Finding[] {
  const scanned: ScannedSource[] = sources.map((source) => ({ path: source.path, scan: scanTypst(source.content) }));
  const files = ctx.projectFiles;
  const bibliography = bibliographyState(scanned, files);
  const labels = new Set(ctx.definedLabels.map((label) => label.trim()));
  for (const source of scanned) for (const label of typstLabels(source.scan)) labels.add(label.name);
  const bibKeys = new Set(ctx.bibKeys.map((key) => key.trim()));
  const tally: ReferenceTally = { cited: new Set<string>(), citations: 0 };
  const packages = importsPackage(scanned);

  const perFile = scanned.flatMap((source) =>
    [
      ...referenceFindings(source, labels, bibKeys, bibliography, tally, packages),
      ...duplicateLabelFindings(source.scan),
      ...assetFindings(source, files, bibliography),
    ]
      .sort((a, b) => (a.from ?? 0) - (b.from ?? 0))
      .map((finding) => withFile(finding, source.path)),
  );

  const project: Finding[] = [];
  if (tally.citations > 0 && !bibliography.declared) {
    project.push({
      id: "refs-no-bibliography",
      lens: "refs",
      severity: "error",
      certainty: "verified",
      title: message("rules.refs-no-bibliography.title"),
      detail: message("rules.refs-no-bibliography.detail"),
    });
  }
  project.push(
    ...duplicateDoiFindings(ctx),
    ...bibliographyQuality({ ...ctx, allCitedKeys: [...tally.cited] }),
    ...projectLabelQuality(ctx),
  );
  return [...perFile, ...project];
}
