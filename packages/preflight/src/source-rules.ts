import { maskComments } from "./mask";
import { findDocumentMetadata, parseMetadataKeys } from "./document-metadata";
import { containsContactToken } from "./contact";
import { matchResumeSectionHeading } from "./resume-sections";
import { annotate } from "./standards";
import { message, type MessageRef } from "./messages";
import type { Finding, Lens, PreflightEngine, Severity } from "./types";

export interface SourceRuleContext {
  engine: PreflightEngine;
}

type Rule = (text: string, context: SourceRuleContext) => Finding[];

const make = (
  id: string,
  lens: Lens,
  severity: Severity,
  title: MessageRef,
  detail: MessageRef,
  range?: { from: number; to: number },
  certainty?: Finding["certainty"],
): Finding => ({ id, lens, severity, title, detail, ...range, ...(certainty ? { certainty } : {}) });

function documentClass(text: string): { opts: string; name: string; from: number; to: number } | null {
  const m = /\\documentclass\s*(?:\[([^\]]*)\]\s*)?\{([^}]*)\}/.exec(text);
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
        message("rules.multi-column.titleTwoColumn"),
        message("rules.multi-column.detailTwoColumn"),
        dc ? { from: dc.from, to: dc.to } : undefined,
      ),
      make(
        "multi-column-reading-order-risk",
        "a11y",
        "info",
        message("rules.multi-column-reading-order-risk.titleTwoColumn"),
        message("rules.multi-column-reading-order-risk.detailTwoColumn"),
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
        message("rules.multi-column.titleMultiColumn"),
        message("rules.multi-column.detailMultiColumn"),
        { from: hit.index, to: hit.index + hit[0].length },
      ),
      make(
        "multi-column-reading-order-risk",
        "a11y",
        "info",
        message("rules.multi-column-reading-order-risk.titleMultiColumn"),
        message("rules.multi-column-reading-order-risk.detailMultiColumn"),
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
      message("rules.no-glyphtounicode.title"),
      message(
        engineNeedsMap
          ? "rules.no-glyphtounicode.detailEngineNeedsMap"
          : "rules.no-glyphtounicode.detailAutomatic",
      ),
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
          message("rules.icon-near-contact.title"),
          message("rules.icon-near-contact.detail"),
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
            message("rules.layout-table.titleTable"),
            message("rules.layout-table.detailTable"),
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
            message("rules.layout-table.titleTikz"),
            message("rules.layout-table.detailTikz"),
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
          message("rules.contact-in-header.title"),
          message("rules.contact-in-header.detail"),
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
  const re = /\\includegraphics\s*(?:\[([^\]]*)\]\s*)?\{([^}]*)\}/g;
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
          message("rules.figure-alt.title"),
          message("rules.figure-alt.detail"),
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
          message("rules.link-text.title"),
          message("rules.link-text.detail"),
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
      message("rules.no-lang.title"),
      message("rules.no-lang.detail"),
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
      message("rules.no-title.title"),
      message("rules.no-title.detail"),
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
  const re = /\\(part|chapter|section|subsection|subsubsection|paragraph|subparagraph)\s*(?:\*\s*)?\{/g;
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
          message("rules.heading-skip.title"),
          message("rules.heading-skip.detail"),
          { from: m.index, to: m.index + m[0].length },
        ),
      );
    }
    prev = level;
  }
  return out;
};

const nonstandardHeadings: Rule = (text) => {
  const re = /\\(?:section|subsection)\s*(?:\*\s*)?\{([^}]*)\}/g;
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
        message("rules.nonstandard-headings.title", { heading: t.label }),
        message("rules.nonstandard-headings.detail"),
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
      message("rules.color-only.title"),
      message("rules.color-only.detail"),
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
      message("rules.reading-order-risk.title"),
      message("rules.reading-order-risk.detail"),
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
  const detailKey = !hasTitle && !showsTitle
    ? "rules.ua-standard-without-title.detailBoth"
    : hasTitle
      ? "rules.ua-standard-without-title.detailDisplay"
      : "rules.ua-standard-without-title.detailTitle";
  return [
    make(
      "ua-standard-without-title",
      "a11y",
      "warning",
      message("rules.ua-standard-without-title.title"),
      message(detailKey),
      { from: declaration.from, to: declaration.to },
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
      message("rules.ua-standard-on-tectonic.title"),
      message("rules.ua-standard-on-tectonic.detail"),
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
    const end = text.indexOf(String.raw`\end{${m[1]}}`, m.index);
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
        message("rules.table-header-rows.title"),
        message("rules.table-header-rows.detail"),
        { from: m.index, to: m.index + m[0].length },
      ),
    ];
  }
  return [];
};

const RULES: Rule[] = [
  multiColumn,
  noGlyphToUnicode,
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
