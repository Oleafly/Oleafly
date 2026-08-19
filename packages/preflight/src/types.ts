export const CHECK_IDS = [
  "ats",
  "compile",
  "a11y",
  "refs",
  "submission",
  "privacy",
] as const;

export type CheckId = (typeof CHECK_IDS)[number];
export type Lens = CheckId | "both";

export type Severity = "error" | "warning" | "info";

export interface Finding {
  id: string;
  lens: Lens;
  severity: Severity;
  // Uses commas/periods, never em dashes (project style).
  title: string;
  detail: string;
  from?: number;
  to?: number;
  page?: number;
  file?: string;
  /**
   * Verified findings are direct observations. Advisory findings are strong,
   * documented heuristics. Manual findings identify requirements that cannot
   * be proved from the source/PDF data available to the app.
   */
  certainty?: "verified" | "advisory" | "manual";
}

export type Coverage = "evaluated" | "partial" | "not_run" | "unsupported";
export type CheckScores = Record<CheckId, number>;
export type CheckCoverage = Record<CheckId, Coverage>;

export interface PreflightReport {
  findings: Finding[];
  scores: CheckScores;
  atsScore: number | null;
  compileScore: number | null;
  a11yScore: number | null;
  refsScore: number | null;
  submissionScore: number | null;
  privacyScore: number | null;
  coverage: CheckCoverage;
  ranAt: number;
  hasPdf: boolean;
  atsParse?: import("./ats-parse").AtsParse;
}

export type PdfExtractionState = "ok" | "failed";

export interface PdfExtractionStatus {
  metadata: PdfExtractionState;
  markInfo: PdfExtractionState;
  structure: PdfExtractionState;
  structureFailedPages: number[];
}

export interface PositionedText {
  str: string;
  x: number;
  y: number;
  width: number;
  height?: number;
}

export interface PdfPageFacts {
  width: number;
  height: number;
  rotation: number;
}

export interface PdfFacts {
  version: string | null;
  pageCount: number;
  pages: PdfPageFacts[];
  outlineCount: number;
  linkCount: number;
  attachmentCount: number;
  formFieldCount: number;
  restricted: boolean | null;
  author: string | null;
  creator: string | null;
  producer: string | null;
  fonts: { name: string; embedded: boolean | null }[];
}

export interface ProjectFile {
  path: string;
  content?: string;
}

export interface ProjectContext {
  mainFile: string;
  files: ProjectFile[];
}
