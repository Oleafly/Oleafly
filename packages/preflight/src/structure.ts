import { annotate } from "./standards";
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
      title: "The tag tree looks like a first compile pass",
      detail:
        "The PDF is marked as tagged but its structure tree holds almost nothing, which is what a single pass produces. Tagged output needs two passes. Compile again and re-check.",
    }),
  ];
}

function claimMismatch(ua: PdfUaFacts, tagged: boolean): Finding[] {
  if (ua.uaPart === null) return [];
  const gaps = [
    !ua.xmpTitle && "no document title in the XMP metadata",
    ua.displayDocTitle === false && "DisplayDocTitle is not set to true",
    !tagged && "the file is not tagged",
  ].filter((gap): gap is string => typeof gap === "string");
  if (gaps.length === 0) return [];
  return [
    observed({
      id: "pdf-ua-claim-mismatch",
      severity: "error",
      title: `This PDF claims PDF/UA-${ua.uaPart} but does not meet it`,
      detail:
        `The XMP metadata declares pdfuaid:part ${ua.uaPart}, but the file does not back that up: ${gaps.join("; ")}. Anything that trusts the claim will report this PDF as conforming when it is not, so either close the gaps or drop the claim. With hyperref, set \\hypersetup{pdftitle={Your title}, pdfdisplaydoctitle=true} and compile with tagging on.`,
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
        title: "The reader will show the filename, not the title",
        detail:
          "ViewerPreferences has no DisplayDocTitle entry set to true, so a PDF reader announces the filename in its window and to assistive tech. Set it with hyperref, for example \\hypersetup{pdfdisplaydoctitle=true}.",
        certainty: "verified",
      }),
    );
  }
  if (ua.suspects === true) {
    out.push(
      observed({
        id: "pdf-suspects",
        severity: "warning",
        title: "The PDF marks its own tagging as unreliable",
        detail:
          "MarkInfo sets Suspects to true, which is the producer saying the tag tree may not match the visible content. Recompile with a current engine, and check the tagging warnings in the log.",
        certainty: "verified",
      }),
    );
  }
  if (!ua.xmpTitle && ua.infoTitle) {
    out.push(
      observed({
        id: "pdf-xmp-title",
        severity: "warning",
        title: "The title is only in the Info dictionary",
        detail:
          "The document title is set in the Info dictionary but not as dc:title in the XMP metadata, which is where PDF/UA looks for it. Loading hyperref with pdftitle writes both.",
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
        title: `${linksWithoutContents} link annotation${linksWithoutContents === 1 ? " has" : "s have"} no description`,
        detail:
          "A link annotation with no Contents entry gives a screen reader nothing to announce when it lists the links on a page. Describe the destination in the link text, and let hyperref carry that text into the annotation.",
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
        title: `${percent}% of the text sits outside the tag tree`,
        detail:
          `${ua.untaggedTextRuns} of ${totalRuns} text runs are not linked to anything in the tag tree, so a screen reader skips them. Artifacts are not counted. Real content has to be tagged, and decorative content has to be marked as an artifact, for example \\includegraphics[artifact]{...}.`,
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
            title: "PDF structure could not be fully inspected",
            detail: `The accessibility structure tree could not be extracted for page${
              structureFailedPages.length === 1 ? "" : "s"
            } ${structureFailedPages.join(", ")}. Preflight will not treat the unavailable structure as proof that the PDF is untagged.`,
          }),
        ]
      : [];

  if (doc.tagged === null) return extractionFindings;
  if (!doc.tagged) {
    return [
      ...extractionFindings,
      observed({
        id: "pdf-untagged-output",
        severity: "info",
        title: "This PDF is not tagged",
        detail:
          "The compiled PDF carries no structure tree, so a screen reader gets no headings, lists, tables, or reading order, and the file cannot satisfy PDF/UA-1 clause 7.1. Tagged output needs pdfLaTeX or LuaLaTeX from TeX Live 2025 or newer with \\DocumentMetadata{tagging=on}. The bundled engine cannot produce tags. The source and output checks above still apply in the meantime.",
      }),
      ...(doc.ua ? claimMismatch(doc.ua, false) : []),
    ];
  }
  if (!doc.root) {
    if (structureFailedPages.length > 0) return extractionFindings;
    return [
      observed({
        id: "pdf-structure-missing",
        severity: "warning",
        title: "Tagged PDF has no readable structure tree",
        detail:
          "The PDF declares itself tagged, but Preflight found no document structure to navigate. Screen readers may not receive headings, lists, tables, or reading order. Tagging needs two compile passes, so compile again and re-check before treating this as final.",
      }),
      ...(doc.ua ? [...claimMismatch(doc.ua, false), ...catalogUaFindings(doc.ua)] : []),
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
          title: "Tagged figure has no alt text",
          detail:
            "This figure is tagged but carries no alternative text, so a screen reader cannot describe it. Add a description at the source, for example \\includegraphics[alt={...}]{...}. Mark decorative images with [artifact] instead.",
        }),
      );
    }

    if (n.role === "Formula" && (!n.alt || !n.alt.trim())) {
      out.push(
        observed({
          id: "output-formula-alt",
          severity: "warning",
          title: "Equation has no text alternative",
          detail:
            "Under PDF/UA-1 a Formula needs Alt or ActualText. Add one at the source, for example with \\tagpdfsetup or an alt key on the equation. Under PDF/UA-2 you can associate MathML instead by compiling with LuaLaTeX and \\DocumentMetadata{tagging-setup={math/setup=mathml-SE}}.",
        }),
      );
    }

    if (n.role === "Table" && !hasRole(n, "TH")) {
      out.push(
        observed({
          id: "output-table-headers",
          severity: "warning",
          title: "Tagged table has no header cells",
          detail:
            "This table has no header (TH) cells, so a screen reader cannot associate data with its column or row headings. Mark the header row, for example \\DocumentMetadata{tagging-setup={table/header-rows={1}}}.",
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
          title: "Heading level skipped in the tag tree",
          detail:
            "The tagged headings jump more than one level (for example H1 straight to H3), which breaks the outline a screen reader navigates by. Do not skip heading levels.",
        }),
      );
      break;
    }
  }

  if (doc.ua) out.push(...claimMismatch(doc.ua, true), ...catalogUaFindings(doc.ua));
  out.push(...singlePassFinding(countNodes(doc.root) - 1));

  return out;
}
