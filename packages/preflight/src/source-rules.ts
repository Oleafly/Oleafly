import { maskComments } from "./mask";
import type { Finding, Lens, Severity } from "./types";

type Rule = (text: string) => Finding[];

const make = (
  id: string,
  lens: Lens,
  severity: Severity,
  title: string,
  detail: string,
  range?: { from: number; to: number },
): Finding => ({ id, lens, severity, title, detail, ...range });

// A contact token: email, tel/mailto href, or a phone-like run of digits.
const CONTACT = /[\w.+-]+@[\w-]+\.[\w.-]+|(?:mailto:|tel:)|\+?\d[\d\s().-]{7,}\d/;

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
        "both",
        "error",
        "Two-column layout",
        "Parsers read left to right across the page, so a two-column layout interleaves the columns into scrambled text, and screen readers lose the reading order. Prefer a single-column layout for anything that must be parsed.",
        dc ? { from: dc.from, to: dc.to } : undefined,
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
        "both",
        "error",
        "Multi-column layout",
        "Multi-column output is read across columns by parsers and screen readers, scrambling the text order. Use a single column for parseable content.",
        { from: hit.index, to: hit.index + hit[0].length },
      ),
    ];
  }
  return [];
};

const noGlyphToUnicode: Rule = (text) => {
  if (!documentClass(text)) return [];
  const ok = /\\pdfgentounicode|glyphtounicode|\\usepackage(?:\[[^\]]*\])?\{cmap\}/.test(text);
  if (ok) return [];
  return [
    make(
      "no-glyphtounicode",
      "both",
      "warning",
      "No Unicode glyph map",
      "Without a glyph-to-Unicode map, ligatures like 'ffi' extract as garbled text ('o ce' for 'office'), which breaks both copy-paste for parsers and screen-reader output. Add \\input{glyphtounicode} and \\pdfgentounicode=1, or load the cmap package.",
    ),
  ];
};

const iconNearContact: Rule = (text) => {
  const out: Finding[] = [];
  let offset = 0;
  for (const line of text.split("\n")) {
    const icon = /\\fa[A-Za-z]/.exec(line);
    if (icon && CONTACT.test(line)) {
      out.push(
        make(
          "icon-near-contact",
          "both",
          "warning",
          "Icon next to contact info",
          "Font icons (like \\faPhone or \\faEnvelope) render as glyphs a parser reads as unknown characters and a screen reader cannot label, so the contact detail beside them can be lost. Make sure the email or phone is also present as plain selectable text.",
          { from: offset + icon.index, to: offset + icon.index + icon[0].length },
        ),
      );
    }
    offset += line.length + 1;
  }
  return out;
};

const layoutTable: Rule = (text) => {
  const m = /\\begin\{(tabular\*?|tabularx|tikzpicture)\}/.exec(text);
  if (!m) return [];
  return [
    make(
      "layout-table",
      "both",
      "warning",
      "Table or TikZ used for layout",
      "Content inside tabular or TikZ is often dropped entirely by resume parsers and carries no structure for screen readers. If you are using it to place text side by side, switch to a linear layout.",
      { from: m.index, to: m.index + m[0].length },
    ),
  ];
};

const HEADER_MACRO = /\\(?:fancyhead|fancyfoot|lhead|rhead|chead|lfoot|rfoot|cfoot)\s*(?:\[[^\]]*\])?\{([^}]*)\}/g;

const contactInHeader: Rule = (text) => {
  const out: Finding[] = [];
  let m: RegExpExecArray | null;
  const re = new RegExp(HEADER_MACRO.source, "g");
  while ((m = re.exec(text))) {
    if (CONTACT.test(m[1])) {
      out.push(
        make(
          "contact-in-header",
          "ats",
          "warning",
          "Contact info in the page header",
          "Parsers skip page headers and footers a quarter to a third of the time, so contact details placed there often disappear. Put your email and phone in the document body.",
          { from: m.index, to: m.index + m[0].length },
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
          "error",
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

const RESUME_HEADINGS = new Set([
  "experience",
  "work experience",
  "professional experience",
  "education",
  "skills",
  "technical skills",
  "projects",
  "summary",
  "objective",
  "certifications",
  "awards",
  "honors",
  "publications",
  "activities",
  "interests",
  "contact",
  "references",
  "leadership",
  "volunteer",
  "volunteering",
  "coursework",
  "achievements",
]);

const nonstandardHeadings: Rule = (text) => {
  const re = /\\(?:section|subsection)\s*\*?\s*\{([^}]*)\}/g;
  const titles: { label: string; from: number; to: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    titles.push({ label: m[1].trim(), from: m.index, to: m.index + m[0].length });
  }
  // Only treat this as a resume (and thus flag odd headings) when at least one
  // standard resume heading is present. Avoids false positives on papers.
  const looksLikeResume = titles.some((t) => RESUME_HEADINGS.has(t.label.toLowerCase()));
  if (!looksLikeResume) return [];
  return titles
    .filter((t) => t.label && !RESUME_HEADINGS.has(t.label.toLowerCase()))
    .map((t) =>
      make(
        "nonstandard-headings",
        "ats",
        "info",
        `Nonstandard section heading: "${t.label}"`,
        "Parsers map sections by recognizing standard headings like Experience, Education, and Skills. A creative title can leave that section uncategorized. Consider a conventional heading.",
        { from: t.from, to: t.to },
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
      "Color used to convey meaning",
      "Color is not perceivable by everyone and is stripped from the text a parser reads, so anything communicated only by color is lost. Pair it with text, weight, or an icon that also has a label.",
      { from: m.index, to: m.index + m[0].length },
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
    ),
  ];
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
];

export function runSourceRules(text: string): Finding[] {
  // Blank out commented-out LaTeX first so `% \usepackage{multicol}` does not
  // raise a false error. Offsets are preserved (comments become spaces).
  const masked = maskComments(text);
  return RULES.flatMap((rule) => rule(masked)).sort((a, b) => (a.from ?? 0) - (b.from ?? 0));
}
