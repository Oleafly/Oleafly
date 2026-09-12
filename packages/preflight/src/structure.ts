import { annotate } from "./standards";
import { message, type MessageRef } from "./messages";
import type { Finding } from "./types";

export interface StructNode {
  role: string;
  alt?: string | null;
  lang?: string | null;
  ids?: string[];
  children: StructNode[];
}

export interface PdfUaFacts {
  displayDocTitle: boolean | null;
  suspects: boolean | null;
  xmpTitle: string | null;
  infoTitle: string | null;
  uaPart: number | null;
  uaRev: string | null;
  taggedTextRuns: number;
  untaggedTextRuns: number;
  artifactTextRuns?: number;
  links: { hasContents: boolean }[];
}

export interface StructDoc {
  root: StructNode | null;
  tagged: boolean | null;
  ua?: PdfUaFacts;
}

const UNTAGGED_CONTENT_SHARE = 0.05;

function hasRole(node: StructNode, role: string): boolean {
  if (node.role === role) return true;
  return node.children.some((c) => hasRole(c, role));
}

function walk(node: StructNode, visit: (n: StructNode) => void) {
  visit(node);
  for (const c of node.children) walk(c, visit);
}

function countNodes(node: StructNode): number {
  return node.children.reduce((total, child) => total + countNodes(child), 1);
}

const observed = (finding: Omit<Finding, "lens">): Finding =>
  annotate({ ...finding, lens: "a11y" }, "pdf-object-model");

function singlePassFinding(structuralNodes: number): Finding[] {
  if (structuralNodes > 1) return [];
  return [
    observed({
      id: "pdf-structure-single-pass",
      severity: "info",
      title: message("rules.pdf-structure-single-pass.title"),
      detail: message("rules.pdf-structure-single-pass.detail"),
    }),
  ];
}

function claimMismatch(ua: PdfUaFacts, tagged: boolean): Finding[] {
  if (ua.uaPart === null) return [];
  const gaps = [
    !ua.xmpTitle ? message("rules.pdf-ua-claim-mismatch.partNoXmpTitle") : null,
    ua.displayDocTitle === false ? message("rules.pdf-ua-claim-mismatch.partNoDisplayDocTitle") : null,
    !tagged ? message("rules.pdf-ua-claim-mismatch.partNotTagged") : null,
  ].filter((gap): gap is MessageRef => gap !== null);
  if (gaps.length === 0) return [];
  return [
    observed({
      id: "pdf-ua-claim-mismatch",
      severity: "error",
      title: message("rules.pdf-ua-claim-mismatch.title", { part: ua.uaPart }),
      detail: message("rules.pdf-ua-claim-mismatch.detail", { part: ua.uaPart }),
      detailParts: [...gaps, message("rules.pdf-ua-claim-mismatch.partAdvice")],
      certainty: "verified",
    }),
  ];
}

function xmpTitleFindings(ua: PdfUaFacts): Finding[] {
  if (ua.xmpTitle || !ua.infoTitle) return [];
  return [
    observed({
      id: "pdf-xmp-title",
      severity: "warning",
      title: message("rules.pdf-xmp-title.title"),
      detail: message("rules.pdf-xmp-title.detail"),
      certainty: "verified",
    }),
  ];
}

function catalogUaFindings(ua: PdfUaFacts): Finding[] {
  const out: Finding[] = [];
  if (ua.displayDocTitle === false) {
    out.push(
      observed({
        id: "pdf-display-doc-title",
        severity: "warning",
        title: message("rules.pdf-display-doc-title.title"),
        detail: message("rules.pdf-display-doc-title.detail"),
        certainty: "verified",
      }),
    );
  }
  if (ua.suspects === true) {
    out.push(
      observed({
        id: "pdf-suspects",
        severity: "warning",
        title: message("rules.pdf-suspects.title"),
        detail: message("rules.pdf-suspects.detail"),
        certainty: "verified",
      }),
    );
  }
  const linksWithoutContents = ua.links.filter((link) => !link.hasContents).length;
  if (linksWithoutContents > 0) {
    out.push(
      observed({
        id: "pdf-link-alt",
        severity: "warning",
        title: message("rules.pdf-link-alt.title", { count: linksWithoutContents }),
        detail: message("rules.pdf-link-alt.detail"),
        certainty: "verified",
      }),
    );
  }
  const totalRuns = ua.taggedTextRuns + ua.untaggedTextRuns;
  if (totalRuns > 0 && ua.untaggedTextRuns / totalRuns > UNTAGGED_CONTENT_SHARE) {
    const percent = Math.round((ua.untaggedTextRuns / totalRuns) * 100);
    out.push(
      observed({
        id: "pdf-untagged-content",
        severity: "warning",
        title: message("rules.pdf-untagged-content.title", { percent }),
        detail: message("rules.pdf-untagged-content.detail", {
          untagged: ua.untaggedTextRuns,
          total: totalRuns,
        }),
        certainty: "verified",
      }),
    );
  }
  return out;
}

export function verifyStructure(
  doc: StructDoc,
  structureFailedPages: readonly number[] = [],
): Finding[] {
  const extractionFindings: Finding[] =
    structureFailedPages.length > 0
      ? [
          observed({
            id: "pdf-structure-extraction-failed",
            severity: "info",
            title: message("rules.pdf-structure-extraction-failed.title"),
            detail: message("rules.pdf-structure-extraction-failed.detail", {
              count: structureFailedPages.length,
              pages: structureFailedPages.join(", "),
            }),
          }),
        ]
      : [];
  const titleFindings = doc.ua ? xmpTitleFindings(doc.ua) : [];

  if (doc.tagged === null) return [...extractionFindings, ...titleFindings];
  if (!doc.tagged) {
    return [
      ...extractionFindings,
      observed({
        id: "pdf-untagged-output",
        severity: "info",
        title: message("rules.pdf-untagged-output.title"),
        detail: message("rules.pdf-untagged-output.detail"),
      }),
      ...(doc.ua ? claimMismatch(doc.ua, false) : []),
      ...titleFindings,
    ];
  }
  if (!doc.root) {
    if (structureFailedPages.length > 0) return [...extractionFindings, ...titleFindings];
    return [
      observed({
        id: "pdf-structure-missing",
        severity: "warning",
        title: message("rules.pdf-structure-missing.title"),
        detail: message("rules.pdf-structure-missing.detail"),
      }),
      ...(doc.ua ? [...claimMismatch(doc.ua, false), ...titleFindings, ...catalogUaFindings(doc.ua)] : []),
      ...singlePassFinding(0),
    ];
  }

  const out: Finding[] = [...extractionFindings];
  const headingLevels: number[] = [];

  walk(doc.root, (n) => {
    const h = /^H([1-6])$/.exec(n.role);
    if (h) headingLevels.push(Number(h[1]));

    if (n.role === "Figure" && (!n.alt || !n.alt.trim())) {
      out.push(
        observed({
          id: "output-figure-alt",
          severity: "error",
          title: message("rules.output-figure-alt.title"),
          detail: message("rules.output-figure-alt.detail"),
        }),
      );
    }

    if (n.role === "Formula" && (!n.alt || !n.alt.trim())) {
      out.push(
        observed({
          id: "output-formula-alt",
          severity: "warning",
          title: message("rules.output-formula-alt.title"),
          detail: message("rules.output-formula-alt.detail"),
        }),
      );
    }

    if (n.role === "Table" && !hasRole(n, "TH")) {
      out.push(
        observed({
          id: "output-table-headers",
          severity: "warning",
          title: message("rules.output-table-headers.title"),
          detail: message("rules.output-table-headers.detail"),
        }),
      );
    }
  });

  for (let i = 1; i < headingLevels.length; i++) {
    if (headingLevels[i] > headingLevels[i - 1] + 1) {
      out.push(
        observed({
          id: "output-heading-skip",
          severity: "warning",
          title: message("rules.output-heading-skip.title"),
          detail: message("rules.output-heading-skip.detail"),
        }),
      );
      break;
    }
  }

  if (doc.ua) out.push(...claimMismatch(doc.ua, true), ...titleFindings, ...catalogUaFindings(doc.ua));
  out.push(...singlePassFinding(countNodes(doc.root) - 1));

  return out;
}
