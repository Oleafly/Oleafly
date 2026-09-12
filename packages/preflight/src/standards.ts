import type { Finding, FindingMethod, StandardRef } from "./types";

const UA1_URL = "https://pdfa.org/resource/iso-14289-pdfua/";
const UA2_URL =
  "https://pdfa.org/iso-14289-2-pdf-ua-2-the-gold-standard-for-accessibility-in-pdf-2-0-has-arrived/";
const MATTERHORN_URL =
  "https://pdfa.org/rules-for-accessible-pdf-matterhorn-protocol-1-1-is-now-available/";
const WCAG_PDF_TECHNIQUES_URL = "https://www.w3.org/WAI/WCAG22/Techniques/#pdf";

export const PDF_UA_1_MACHINE_RULE_TOTAL = 106;

export const PDF_UA_1_COVERED_RULES = [
  "5-1",
  "5-2",
  "6.2-1",
  "7.1-3",
  "7.1-4",
  "7.1-9",
  "7.1-10",
  "7.1-11",
  "7.2-29",
  "7.3-1",
  "7.4.2-1",
  "7.5-1",
  "7.5-2",
  "7.18.5-2",
] as const;

export const DIAGNOSTIC_FINDING_IDS = [
  "pdf-metadata-extraction-failed",
  "pdf-mark-info-extraction-failed",
  "pdf-structure-extraction-failed",
];

const isDiagnostic = (id: string) => DIAGNOSTIC_FINDING_IDS.includes(id);

const ua1 = (clause: string, label: string, verapdfRule?: string): StandardRef => ({
  standard: "PDF/UA-1",
  clause,
  label,
  ...(verapdfRule ? { verapdfRule } : {}),
  url: UA1_URL,
});

const ua2 = (
  clause: string | readonly number[],
  label: string,
  verapdfRule?: string,
): StandardRef => ({
  standard: "PDF/UA-2",
  clause: typeof clause === "string" ? clause : clause.join("."),
  label,
  ...(verapdfRule ? { verapdfRule } : {}),
  url: UA2_URL,
});

const matterhorn = (clause: string, label: string): StandardRef => ({
  standard: "Matterhorn-1.1",
  clause,
  label,
  url: MATTERHORN_URL,
});

const wcag = (clause: string, label: string, technique?: string): StandardRef => ({
  standard: "WCAG-2.2",
  clause,
  label,
  ...(technique ? { technique } : {}),
  url: technique ? `https://www.w3.org/WAI/WCAG22/Techniques/pdf/${technique}` : WCAG_PDF_TECHNIQUES_URL,
});

const TAGGED_REFS: StandardRef[] = [
  ua1("7.1", "Tagged PDF", "7.1-11"),
  ua1("6.2", "File format", "6.2-1"),
  ua2("8.2.1", "Structure"),
  matterhorn("01-005", "Tagged content"),
  wcag("1.3.1", "Info and Relationships", "PDF9"),
];

const FIGURE_REFS: StandardRef[] = [
  ua1("7.3", "Graphics", "7.3-1"),
  ua2("8.2.5.28.2", "Figure"),
  matterhorn("13-004", "Alternative descriptions"),
  wcag("1.1.1", "Non-text Content", "PDF1"),
];

const TITLE_REFS: StandardRef[] = [
  ua1("7.1", "Document title", "7.1-9"),
  ua2("8.11.1", "Metadata"),
  matterhorn("06-003", "Metadata"),
  wcag("2.4.2", "Page Titled", "PDF18"),
];

const LANG_REFS: StandardRef[] = [
  ua1("7.2", "Text", "7.2-29"),
  ua2("8.4.4", "Natural language"),
  matterhorn("11-001", "Natural language"),
  wcag("3.1.1", "Language of Page", "PDF16"),
];

const HEADING_REFS: StandardRef[] = [
  ua1("7.4", "Headings", "7.4.2-1"),
  matterhorn("14-003", "Headings"),
  wcag("1.3.1", "Info and Relationships", "PDF9"),
  wcag("2.4.6", "Headings and Labels"),
];

const LINK_REFS: StandardRef[] = [
  ua1("7.18.5", "Links", "7.18.5-2"),
  matterhorn("28-005", "Annotations"),
  wcag("2.4.4", "Link Purpose (In Context)", "PDF11"),
  wcag("2.4.4", "Link Purpose (In Context)", "PDF13"),
];

const READING_ORDER_REFS: StandardRef[] = [
  matterhorn("09", "Reading order"),
  wcag("1.3.2", "Meaningful Sequence", "PDF3"),
];

const ENCODING_REFS: StandardRef[] = [
  ua1("7.21.7", "Character encoding"),
  ua2([8, 4, 5, 8], "Character encoding"),
  matterhorn("10-001", "Character encoding"),
  wcag("1.4.5", "Images of Text", "PDF7"),
];

interface StandardEntry {
  refs: StandardRef[];
  machineCheckable: boolean;
}

const machine = (refs: StandardRef[]): StandardEntry => ({ refs, machineCheckable: true });
const judgement = (refs: StandardRef[]): StandardEntry => ({ refs, machineCheckable: false });

const TABLE: Record<string, StandardEntry> = {
  "pdf-untagged-output": machine(TAGGED_REFS),
  "pdf-structure-missing": machine(TAGGED_REFS),
  "pdf-structure-single-pass": machine([ua1("7.1", "Tagged PDF", "7.1-11"), matterhorn("01-005", "Tagged content")]),
  "pdf-untagged-content": machine([
    ua1("7.1", "Tagged PDF", "7.1-3"),
    ua2("8.2.2", "Real content"),
    matterhorn("01-005", "Tagged content"),
    wcag("1.3.1", "Info and Relationships", "PDF9"),
  ]),
  "pdf-suspects": machine([ua1("7.1", "Tagged PDF", "7.1-4"), matterhorn("01", "Tagged content")]),
  "pdf-ua-claim-mismatch": machine([
    ua1("5", "Conformance", "5-1"),
    ua1("5", "Conformance", "5-2"),
    ua2("5", "Conformance", "5-5"),
    matterhorn("06-003", "Metadata"),
  ]),
  "figure-alt": machine(FIGURE_REFS),
  "output-figure-alt": machine(FIGURE_REFS),
  "output-formula-alt": machine([
    ua1("7.7", "Mathematical expressions"),
    ua2([8, 2, 5, 29], "Formula"),
    matterhorn("17-002", "Mathematical expressions"),
    wcag("1.1.1", "Non-text Content"),
  ]),
  "output-table-headers": machine([
    ua1("7.5", "Tables", "7.5-1"),
    ua1("7.5", "Tables", "7.5-2"),
    matterhorn("15-003", "Tables"),
    wcag("1.3.1", "Info and Relationships", "PDF6"),
  ]),
  "table-header-rows": machine([
    ua1("7.5", "Tables", "7.5-1"),
    matterhorn("15-003", "Tables"),
    wcag("1.3.1", "Info and Relationships", "PDF6"),
  ]),
  "heading-skip": machine(HEADING_REFS),
  "output-heading-skip": machine(HEADING_REFS),
  "no-lang": machine(LANG_REFS),
  "no-title": machine(TITLE_REFS),
  "pdf-xmp-title": machine(TITLE_REFS),
  "pdf-lang-title": machine([...TITLE_REFS, ...LANG_REFS]),
  "pdf-display-doc-title": machine([
    ua1("7.1", "Document title display", "7.1-10"),
    ua2("8.11.2", "Viewer preferences"),
    matterhorn("07-001", "Viewer preferences"),
    wcag("2.4.2", "Page Titled", "PDF18"),
  ]),
  "ua-standard-without-title": machine([...TITLE_REFS, ua1("5", "Conformance", "5-1")]),
  "ua-standard-on-tectonic": machine([ua1("5", "Conformance", "5-1"), ...TAGGED_REFS]),
  "pdf-link-alt": machine(LINK_REFS),
  "link-text": judgement(LINK_REFS),
  "pdf-no-bookmarks": machine([wcag("2.4.5", "Multiple Ways", "PDF2")]),
  "pdf-reading-order": judgement(READING_ORDER_REFS),
  "reading-order-risk": judgement(READING_ORDER_REFS),
  "multi-column-reading-order-risk": judgement(READING_ORDER_REFS),
  "output-small-text": judgement([matterhorn("04", "Colour and contrast"), wcag("1.4.3", "Contrast (Minimum)")]),
  "color-only": judgement([matterhorn("04", "Colour and contrast"), wcag("1.4.1", "Use of Color")]),
  "no-glyphtounicode": machine(ENCODING_REFS),
  "pdf-garbled": machine(ENCODING_REFS),
  "pdf-selectable": machine(ENCODING_REFS),
  "icon-near-contact": judgement([ua1("7.3", "Graphics", "7.3-1"), wcag("1.1.1", "Non-text Content", "PDF1")]),
  "layout-table": judgement([ua1("7.3", "Graphics", "7.3-1"), wcag("1.1.1", "Non-text Content", "PDF1")]),
  "output-tagpdf-warning": machine(TAGGED_REFS),
  "output-tagging-status": machine(TAGGED_REFS),
  "pdf-metadata-extraction-failed": machine([
    ua1("7.1", "Document title", "7.1-9"),
    ua1("7.2", "Text", "7.2-29"),
    matterhorn("06-003", "Metadata"),
    wcag("2.4.2", "Page Titled", "PDF18"),
  ]),
  "pdf-mark-info-extraction-failed": machine([
    ua1("7.1", "Tagged PDF", "7.1-11"),
    ua1("7.1", "Tagged PDF", "7.1-4"),
    matterhorn("01-005", "Tagged content"),
  ]),
  "pdf-structure-extraction-failed": machine([
    ua1("7.3", "Graphics", "7.3-1"),
    ua1("7.4", "Headings", "7.4.2-1"),
    ua1("7.5", "Tables", "7.5-1"),
    matterhorn("01-005", "Tagged content"),
  ]),
};

export function standardsFor(id: string): StandardRef[] {
  return TABLE[id]?.refs ?? [];
}

export function standardRefLabel(ref: StandardRef): string {
  if (ref.standard === "WCAG-2.2") return `WCAG 2.2 SC ${ref.clause}`;
  if (ref.standard === "Matterhorn-1.1") return `Matterhorn ${ref.clause}`;
  return `${ref.standard} ${ref.clause}`;
}

export interface StandardChip {
  label: string;
  url: string;
  detail: string;
}

export function standardChips(refs: readonly StandardRef[] = []): StandardChip[] {
  const chips = new Map<string, { url: string; name?: string; rules: string[]; techniques: string[] }>();
  for (const ref of refs) {
    const label = standardRefLabel(ref);
    const chip = chips.get(label) ?? { url: ref.url, name: ref.label, rules: [], techniques: [] };
    if (ref.verapdfRule && !chip.rules.includes(ref.verapdfRule)) chip.rules.push(ref.verapdfRule);
    if (ref.technique && !chip.techniques.includes(ref.technique)) chip.techniques.push(ref.technique);
    chips.set(label, chip);
  }
  return [...chips].map(([label, chip]) => {
    const parts = [
      chip.name,
      chip.rules.length > 0 ? `veraPDF ${chip.rules.join(", ")}` : null,
      chip.techniques.length > 0 ? `technique${chip.techniques.length > 1 ? "s" : ""} ${chip.techniques.join(", ")}` : null,
    ].filter((part): part is string => Boolean(part));
    return { label, url: chip.url, detail: parts.length > 0 ? `${label}: ${parts.join(", ")}` : label };
  });
}

export function annotate<T extends Finding>(finding: T, method: FindingMethod): T & Finding {
  const entry = TABLE[finding.id];
  const carriesA11y = finding.lens === "a11y" || finding.lens === "both";
  if (!entry || !carriesA11y) return { ...finding, method };
  return {
    ...finding,
    method,
    standards: finding.standards ?? entry.refs,
    machineCheckable: finding.machineCheckable ?? entry.machineCheckable,
  };
}

export type PdfUaRuleOutcome = "passed" | "failed" | "unavailable";

export interface PdfUaAvailability {
  metadata: boolean;
  markInfo: boolean;
  structure: boolean;
  viewerPreferences: boolean;
  annotations: boolean;
  markedContent: boolean;
  identifiesAsPdfUa1: boolean;
  tagged: boolean | null;
}

export const NOTHING_INSPECTED: PdfUaAvailability = {
  metadata: false,
  markInfo: false,
  structure: false,
  viewerPreferences: false,
  annotations: false,
  markedContent: false,
  identifiesAsPdfUa1: false,
  tagged: null,
};

const RULE_AVAILABILITY: Record<string, (facts: PdfUaAvailability) => boolean> = {
  "5-1": (facts) => facts.metadata && facts.identifiesAsPdfUa1,
  "5-2": (facts) => facts.metadata && facts.identifiesAsPdfUa1,
  "6.2-1": (facts) => facts.tagged !== null,
  "7.1-3": (facts) => facts.markedContent && facts.tagged === true,
  "7.1-4": (facts) => facts.markInfo && facts.tagged === true,
  "7.1-9": (facts) => facts.metadata,
  "7.1-10": (facts) => facts.viewerPreferences,
  "7.1-11": (facts) => facts.tagged !== null,
  "7.2-29": (facts) => facts.metadata,
  "7.3-1": (facts) => facts.structure && facts.tagged === true,
  "7.4.2-1": (facts) => facts.structure && facts.tagged === true,
  "7.5-1": (facts) => facts.structure && facts.tagged === true,
  "7.5-2": (facts) => facts.structure && facts.tagged === true,
  "7.18.5-2": (facts) => facts.annotations,
};

export interface PdfUaCoverage {
  total: number;
  covered: number;
  passed: number;
  failed: string[];
  unavailable: string[];
  outcomes: Record<string, PdfUaRuleOutcome>;
}

export function pdfUaCoverage(
  findings: readonly Finding[],
  availability: PdfUaAvailability = NOTHING_INSPECTED,
): PdfUaCoverage {
  const failedRules = new Set<string>();
  for (const finding of findings) {
    if (finding.method !== "pdf-object-model" || isDiagnostic(finding.id)) continue;
    for (const ref of finding.standards ?? []) {
      if (ref.standard === "PDF/UA-1" && ref.verapdfRule) failedRules.add(ref.verapdfRule);
    }
  }
  const outcomes: Record<string, PdfUaRuleOutcome> = {};
  const failed: string[] = [];
  const unavailable: string[] = [];
  let passed = 0;
  for (const rule of PDF_UA_1_COVERED_RULES) {
    const available = RULE_AVAILABILITY[rule]?.(availability) ?? false;
    if (!available) {
      outcomes[rule] = "unavailable";
      unavailable.push(rule);
      continue;
    }
    if (failedRules.has(rule)) {
      outcomes[rule] = "failed";
      failed.push(rule);
      continue;
    }
    outcomes[rule] = "passed";
    passed++;
  }
  return {
    total: PDF_UA_1_MACHINE_RULE_TOTAL,
    covered: PDF_UA_1_COVERED_RULES.length,
    passed,
    failed,
    unavailable,
    outcomes,
  };
}

export function pdfUaCoverageLine(coverage: PdfUaCoverage): string {
  const checked = `PDF/UA-1: ${coverage.passed} of ${coverage.total} machine-checkable rules verified.`;
  const blind =
    coverage.unavailable.length > 0
      ? ` Oleafly reads ${coverage.covered} of those rules, and ${coverage.unavailable.length} of them could not be checked in this file.`
      : "";
  return `${checked}${blind} Subset check, not a conformance statement.`;
}
