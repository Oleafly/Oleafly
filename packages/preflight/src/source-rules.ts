import { maskComments } from "./mask";
import { findDocumentMetadata, parseMetadataKeys } from "./document-metadata";
import { containsContactToken } from "./contact";
import { matchResumeSectionHeading } from "./resume-sections";
import { annotate } from "./standards";
import type { Finding, Lens, PreflightEngine, Severity } from "./types";

export interface SourceRuleContext {
  engine: PreflightEngine;
}

type Rule = (text: string, context: SourceRuleContext) => Finding[];

const make = (
  id: string,
  lens: Lens,
  severity: Severity,
  title: string,
  detail: string,
  range?: { from: number; to: number },
  certainty?: Finding["certainty"],
): Finding => ({ id, lens, severity, title, detail, ...range, ...(certainty ? { certainty } : {}) });

function documentClass(text: string): { opts: string; name: string; from: number; to: number } | null {
  const m = /\\documentclass\s*(?:\[([^\]]*)\])?\s*\{([^}]*)\}/.exec(text);
  if (!m) return null;
  return { opts: m[1] ?? "", name: m[2].trim(), from: m.index, to: m.index + m[0].length };
}

const multiColumn: Rule = (text) => {
  const dc = documentClass(text);
  const twocol = dc && /\btwocolumn\b/.test(dc.opts);
  const twoColClass = dc && /\b(altacv|deedy)/i.test(dc.name);
  if (twocol || twoColClass) {
    return [
      make(
        "multi-column",
        "ats",
        "info",
        "Two-column layout",
        "Resume parsers commonly linearize two columns in the wrong order. Prefer a single-column layout for documents that must be parsed by an ATS.",
        dc ? { from: dc.from, to: dc.to } : undefined,
      ),
      make(
        "multi-column-reading-order-risk",
        "a11y",
        "info",
        "Verify the two-column reading order",
        "Multi-column publishing layouts can be accessible when the PDF tag tree preserves the intended sequence. Compile and confirm the actual reader order instead of treating the visual columns alone as a failure.",
        dc ? { from: dc.from, to: dc.to } : undefined,
        "advisory",
      ),
    ];
  }
  const pkg = /\\usepackage(?:\[[^\]]*\])?\{(?:multicol|paracol)\}/.exec(text);
  const env = /\\begin\{multicols\}/.exec(text);
  const hit = pkg ?? env;
  if (hit) {
    return [
      make(
        "multi-column",
        "ats",
        "info",
        "Multi-column layout",
        "Resume parsers commonly linearize columns in the wrong order. Use a single column for ATS-facing documents.",
        { from: hit.index, to: hit.index + hit[0].length },
      ),
      make(
        "multi-column-reading-order-risk",
        "a11y",
        "info",
        "Verify the multi-column reading order",
        "Columns are not automatically inaccessible, but their tag and content order must remain meaningful. Compile and inspect the actual reader sequence.",
        { from: hit.index, to: hit.index + hit[0].length },
        "advisory",
      ),
    ];
  }
  return [];
};

const noGlyphToUnicode: Rule = (text, context) => {
  if (!documentClass(text)) return [];
  const ok = /\\pdfgentounicode|glyphtounicode|\\usepackage(?:\[[^\]]*\])?\{cmap\}/.test(text);
  if (ok) return [];
  const engineNeedsMap = context.engine === "bundled" || context.engine === "xelatex";
  return [
    make(
      "no-glyphtounicode",
      "both",
      engineNeedsMap ? "warning" : "info",
      "Unicode extraction map is not declared",
      engineNeedsMap
        ? "XeTeX, and the bundled engine that builds on it, do not generate the glyph-to-Unicode map automatically, so extracted text can come out unreadable. Compile and check the reader view, and prefer a font with a full Unicode mapping."
        : "pdfLaTeX and LuaLaTeX have generated this map automatically since the LaTeX 2021-06-01 release, so no declaration is needed. Compile and confirm the extracted reader text. On XeTeX, load cmap or switch engine.",
      undefined,
      "advisory",
    ),
  ];
};

const iconNearContact: Rule = (text) => {
  const out: Finding[] = [];
  let offset = 0;
  for (const line of text.split("\n")) {
    const icon = /\\fa[A-Za-z]/.exec(line);
    if (icon && containsContactToken(line)) {
      out.push(
        make(
          "icon-near-contact",
          "both",
          "warning",
          "Icon next to contact info",
          "Font icons (like \\faPhone or \\faEnvelope) render as glyphs a parser reads as unknown characters and a screen reader cannot label, so the contact detail beside them can be lost. Make sure the email or phone is also present as plain selectable text.",
          { from: offset + icon.index, to: offset + icon.index + icon[0].length },
          "advisory",
        ),
      );
    }
    offset += line.length + 1;
  }
  return out;
};

const layoutTable: Rule = (text) => {
  const tabular = /\\begin\{(tabular\*?|tabularx)\}/.exec(text);
  const tikz = /\\begin\{tikzpicture\}/.exec(text);
  return [
    ...(tabular
      ? [
          make(
            "layout-table",
            "ats",
            "warning",
            "Table content may not parse as resume fields",
            "ATS tools often flatten tabular content unpredictably. Avoid using a table to position resume text side by side; real research data tables are evaluated separately in Accessibility.",
            { from: tabular.index, to: tabular.index + tabular[0].length },
            "advisory",
          ),
        ]
      : []),
    ...(tikz
      ? [
          make(
            "layout-table",
            "both",
            "warning",
            "TikZ content needs a semantic alternative",
            "TikZ draws visual content without exposing its meaning as normal text. Provide an accessible description for publication output and avoid it for ATS-facing resume content.",
            { from: tikz.index, to: tikz.index + tikz[0].length },
            "advisory",
          ),
        ]
      : []),
  ];
};

const HEADER_MACRO = /\\(?:fancyhead|fancyfoot|lhead|rhead|chead|lfoot|rfoot|cfoot)\s*(?:\[[^\]]*\])?\{([^}]*)\}/g;

const contactInHeader: Rule = (text) => {
  const out: Finding[] = [];
  let m: RegExpExecArray | null;
  const re = new RegExp(HEADER_MACRO.source, "g");
  while ((m = re.exec(text))) {
    if (containsContactToken(m[1])) {
      out.push(
        make(
          "contact-in-header",
          "ats",
          "warning",
          "Contact info in the page header",
          "Some resume parsers omit page headers and footers. Put your email and phone in the document body so the extracted text preserves them.",
          { from: m.index, to: m.index + m[0].length },
          "advisory",
        ),
      );
    }
  }
  return out;
};

const figureAlt: Rule = (text) => {
  const out: Finding[] = [];
  const re = /\\includegraphics\s*(?:\[([^\]]*)\])?\s*\{([^}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const opts = m[1] ?? "";
    const file = m[2].trim();
    const altMatch = /\balt\s*=\s*(\{[^}]*\}|[^,\]]*)/.exec(opts);
    const alt = altMatch ? altMatch[1].replace(/^\{|\}$/g, "").trim() : null;
    const bad = alt === null || alt === "" || alt.toLowerCase() === file.toLowerCase();
    if (bad) {
      out.push(
        make(
          "figure-alt",
          "a11y",
          "warning",
          "Image without alt text",
          "This image has no descriptive alt text, so a screen reader cannot convey it. Add a description, for example \\includegraphics[alt={A headshot of the author}]{...}. Mark purely decorative images as artifacts instead.",
          { from: m.index, to: m.index + m[0].length },
        ),
      );
    }
  }
  return out;
};

const WEAK_LINK_TEXT = new Set(["click here", "here", "link", "this link", "this", "read more"]);

const linkText: Rule = (text) => {
  const out: Finding[] = [];
  const re = /\\href\s*\{[^}]*\}\s*\{([^}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const label = m[1].trim();
    const weak = WEAK_LINK_TEXT.has(label.toLowerCase()) || /^https?:\/\//i.test(label);
    if (weak) {
      out.push(
        make(
          "link-text",
          "a11y",
          "warning",
          "Non-descriptive link text",
          "Link text like 'click here' or a bare URL tells a screen-reader user nothing about the destination. Use text that names the target, for example 'my portfolio'.",
          { from: m.index, to: m.index + m[0].length },
        ),
      );
    }
  }
  return out;
};

const noLang: Rule = (text) => {
  if (!documentClass(text)) return [];
  const ok =
    /\\DocumentMetadata\s*\{[^}]*\blang\s*=/.test(text) ||
    /pdflang\s*=/.test(text) ||
    /\\usepackage(?:\[[^\]]*\])?\{(?:babel|polyglossia)\}/.test(text) ||
    /\\setmainlanguage/.test(text);
  if (ok) return [];
  return [
    make(
      "no-lang",
      "a11y",
      "warning",
      "No document language set",
      "The PDF has no language, so a screen reader may read it with the wrong pronunciation rules. Set one, for example \\usepackage[english]{babel} or hyperref's pdflang=en-US.",
    ),
  ];
};

const noTitle: Rule = (text) => {
  if (!documentClass(text)) return [];
  const ok = /pdftitle\s*=/.test(text) || /\\DocumentMetadata\s*\{[^}]*\bpdftitle\s*=/.test(text);
  if (ok) return [];
  return [
    make(
      "no-title",
      "a11y",
      "info",
      "No PDF title",
      "The PDF has no title in its metadata, which assistive tech and browsers use to announce the document. Set one with hyperref, for example \\hypersetup{pdftitle={Your Name, CV}}.",
    ),
  ];
};

const HEADING_LEVEL: Record<string, number> = {
  part: 0,
  chapter: 1,
  section: 2,
  subsection: 3,
  subsubsection: 4,
  paragraph: 5,
  subparagraph: 6,
};

const headingSkip: Rule = (text) => {
  const out: Finding[] = [];
  const re = /\\(part|chapter|section|subsection|subsubsection|paragraph|subparagraph)\s*\*?\s*\{/g;
  let m: RegExpExecArray | null;
  let prev: number | null = null;
  while ((m = re.exec(text))) {
    const level = HEADING_LEVEL[m[1]];
    if (prev !== null && level > prev + 1) {
      out.push(
        make(
          "heading-skip",
          "both",
          "warning",
          "Heading level skipped",
          "This heading jumps more than one level deeper than the previous one, which breaks the document outline that screen readers and parsers rely on. Do not skip levels, for example go section then subsection then subsubsection.",
          { from: m.index, to: m.index + m[0].length },
        ),
      );
    }
    prev = level;
  }
  return out;
};

const nonstandardHeadings: Rule = (text) => {
  const re = /\\(?:section|subsection)\s*\*?\s*\{([^}]*)\}/g;
  const titles: { label: string; from: number; to: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    titles.push({ label: m[1].trim(), from: m.index, to: m.index + m[0].length });
  }
  // Only treat this as a resume (and thus flag odd headings) when at least one
  // standard resume heading is present. Avoids false positives on papers.
  const looksLikeResume = titles.some((title) => matchResumeSectionHeading(title.label) !== null);
  if (!looksLikeResume) return [];
  return titles
    .filter((title) => title.label && matchResumeSectionHeading(title.label) === null)
    .map((t) =>
      make(
        "nonstandard-headings",
        "ats",
        "info",
        `Nonstandard section heading: "${t.label}"`,
        "Parsers map sections by recognizing standard headings like Experience, Education, and Skills. A creative title can leave that section uncategorized. Consider a conventional heading.",
        { from: t.from, to: t.to },
        "advisory",
      ),
    );
};

const colorOnly: Rule = (text) => {
  const m = /\\(?:textcolor|color)\s*\{/.exec(text);
  if (!m) return [];
  return [
    make(
      "color-only",
      "a11y",
      "info",
      "Check that color is not the only cue",
      "Preflight found colored content but cannot determine its meaning automatically. If color distinguishes status or categories, pair it with text, shape, weight, or another perceivable cue.",
      { from: m.index, to: m.index + m[0].length },
      "advisory",
    ),
  ];
};

const readingOrderRisk: Rule = (text) => {
  const m = /\\marginpar\b|\\begin\{wrapfigure\}|\\usepackage(?:\[[^\]]*\])?\{wrapfig\}/.exec(text);
  if (!m) return [];
  return [
    make(
      "reading-order-risk",
      "both",
      "info",
      "Layout that can disturb reading order",
      "Margin notes and wrapped figures place content outside the main flow, so parsers and screen readers may read it out of order. Check the reading order in the preview below after compiling.",
      { from: m.index, to: m.index + m[0].length },
      "advisory",
    ),
  ];
};


function uaStandardDeclaration(text: string): { body: string; from: number; to: number } | null {
  const metadata = findDocumentMetadata(text);
  if (!metadata) return null;
  const standard = parseMetadataKeys(metadata.body).map.get("pdfstandard");
  if (!standard || !/^\{?\s*ua/i.test(standard)) return null;
  return { body: metadata.body, from: metadata.start, to: metadata.end };
}

const uaStandardWithoutTitle: Rule = (text) => {
  const declaration = uaStandardDeclaration(text);
  if (!declaration) return [];
  const hasTitle = /pdftitle\s*=/.test(text);
  const showsTitle = /pdfdisplaydoctitle\s*=\s*true/i.test(text);
  if (hasTitle && showsTitle) return [];
  const missing = [!hasTitle && "pdftitle", !showsTitle && "pdfdisplaydoctitle=true"].filter(Boolean).join(" and ");
  return [
    make(
      "ua-standard-without-title",
      "a11y",
      "warning",
      "PDF/UA is declared without a document title",
      `This document declares pdfstandard=ua but sets no ${missing}. PDF/UA requires a title in the XMP metadata and a viewer preference that displays it, so the output would claim a standard it does not meet. Load hyperref and set \\hypersetup{pdftitle={Your title}, pdfdisplaydoctitle=true}.`,
      { from: declaration.from, to: declaration.to },
    ),
  ];
};

// Math renders accessibly on the web only as MathML (or images with alt
// text). When the source contains math, point at the HTML export, which
// pandoc writes with --mathml, as an accessibility check surface (G11).
const mathMlExportHint: Rule = (text) => {
  const hasMath =
    /\\begin\{(?:equation|align|gather|multline|eqnarray|math|displaymath)\*?\}/.test(
      text,
    ) || /(?:^|[^\\$\w])\$[^$]+\$/.test(text) || /\\\[/.test(text);
  if (!hasMath) return [];
  return [
    make(
      "mathml-export-hint",
      "a11y",
      "info",
      "Export an HTML copy with MathML to check math accessibility",
      "The document contains math. Screen readers read equations reliably when they are MathML. Use Export as HTML, which pandoc writes with --mathml, and open the file with a screen reader or an accessibility checker before submission.",
      undefined,
      "advisory",
    ),
  ];
};

const uaStandardOnBundledEngine: Rule = (text, context) => {
  if (context.engine !== "bundled") return [];
  const declaration = uaStandardDeclaration(text);
  if (!declaration) return [];
  return [
    make(
      "ua-standard-on-tectonic",
      "a11y",
      "error",
      "The bundled engine cannot produce the declared PDF/UA output",
      "This document declares pdfstandard=ua, but the bundled engine cannot write a tag tree, so the PDF would carry a PDF/UA claim it does not meet. Compile with pdfLaTeX or LuaLaTeX from TeX Live 2025 or newer, or remove the pdfstandard key.",
      { from: declaration.from, to: declaration.to },
    ),
  ];
};

const HEADER_RULE = /^\s*(?:\[[^\]]*\]\s*)?(?:\\hline|\\midrule|\\cline\b)/;

const tableHeaderRows: Rule = (text) => {
  if (/table\/header-rows/.test(text)) return [];
  const re = /\\begin\{(tabular\*?|tabularx|longtable)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const end = text.indexOf(`\\end{${m[1]}}`, m.index);
    const body = text.slice(m.index + m[0].length, end === -1 ? text.length : end);
    const firstRowEnd = body.indexOf("\\\\");
    if (firstRowEnd === -1) continue;
    const afterFirstRow = body.slice(firstRowEnd + 2);
    const nextRowEnd = afterFirstRow.indexOf("\\\\");
    const gap = nextRowEnd === -1 ? afterFirstRow : afterFirstRow.slice(0, nextRowEnd);
    if (!HEADER_RULE.test(gap)) continue;
    return [
      make(
        "table-header-rows",
        "a11y",
        "warning",
        "Table header row is not marked as a header",
        "This table rules off its first row, so it reads as a header, but LaTeX tags every cell as a data cell by default. A screen reader then cannot tie a value to its column. Declare the header row, for example \\DocumentMetadata{tagging-setup={table/header-rows={1}}}.",
        { from: m.index, to: m.index + m[0].length },
      ),
    ];
  }
  return [];
};

const RULES: Rule[] = [
  multiColumn,
  noGlyphToUnicode,
  mathMlExportHint,
  iconNearContact,
  layoutTable,
  contactInHeader,
  figureAlt,
  linkText,
  noLang,
  noTitle,
  headingSkip,
  nonstandardHeadings,
  colorOnly,
  readingOrderRisk,
  uaStandardWithoutTitle,
  uaStandardOnBundledEngine,
  tableHeaderRows,
];

export function runSourceRules(text: string, context?: Partial<SourceRuleContext>): Finding[] {
  // Blank out commented-out LaTeX first so `% \usepackage{multicol}` does not
  // raise a false error. Offsets are preserved (comments become spaces).
  const masked = maskComments(text);
  const resolved: SourceRuleContext = { engine: context?.engine ?? "unknown" };
  return RULES.flatMap((rule) => rule(masked, resolved))
    .map((finding) => annotate(finding, "source-heuristic"))
    .sort((a, b) => (a.from ?? 0) - (b.from ?? 0));
}
