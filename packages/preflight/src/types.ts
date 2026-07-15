export type Lens = "ats" | "a11y" | "both" | "refs";

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
}

export interface PreflightReport {
  findings: Finding[];
  atsScore: number | null;
  a11yScore: number | null;
  refsScore: number | null;
  coverage: Record<"ats" | "a11y" | "refs", "evaluated" | "not_run" | "unsupported">;
  ranAt: number;
  hasPdf: boolean;
  atsParse?: import("./ats-parse").AtsParse;
}

export interface PositionedText {
  str: string;
  x: number;
  y: number;
  width: number;
}
