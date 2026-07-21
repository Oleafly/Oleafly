export interface TextItem {
  str: string;
  /** left edge, PDF user units, origin bottom-left */
  x: number;
  /** baseline */
  y: number;
  width: number;
  height: number;
  fontName: string;
  fontSize: number;
}

export interface PageInput {
  width: number;
  height: number;
  items: TextItem[];
  /** filenames of figures extracted on this page */
  figureNames: string[];
}

export interface ConvertOptions {
  /** 1-based inclusive */
  pageRange?: [number, number];
  columns?: "auto" | 1 | 2;
  /** 0..1, default 0.5; higher means more headings */
  headingSensitivity?: number;
}

export interface ReportNote {
  page: number;
  kind: "table-as-text" | "no-text-layer" | "low-confidence" | "figure-extracted";
  detail: string;
}

export interface ConversionReport {
  pages: number;
  headings: number;
  paragraphs: number;
  equations: number;
  figures: number;
  likelyScanned: boolean;
  notes: ReportNote[];
}

export interface ExtractedFigure {
  name: string;
  page: number;
  pngDataUrl: string;
}

export interface ConvertResult {
  tex: string;
  report: ConversionReport;
}
