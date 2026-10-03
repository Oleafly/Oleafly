export interface VisualImage {
  url: string;
  kind: "raster" | "svg" | "pdf";
}

export interface VisualRange {
  from: number;
  to: number;
}

export type VisualReferenceKind = "label" | "citation";

export interface VisualPorts {
  resolveImage(path: string): Promise<VisualImage | null>;
  openFigureEditor?(range: VisualRange): void;
  referenceKind?(key: string): VisualReferenceKind | null;
}
