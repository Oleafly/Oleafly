export type PdfjsAssetFolder = { files: number; bytes: number };
export type PdfjsAssetMeasure = Record<string, PdfjsAssetFolder>;
export const PDFJS_ASSET_LIMITS: Readonly<Record<string, number>>;
export function measurePdfjsAssets(pdfjsDir: string | URL): Promise<PdfjsAssetMeasure>;
export function pdfjsAssetFailures(measured: PdfjsAssetMeasure, limits?: Readonly<Record<string, number>>): string[];
export function pdfjsAssetSummary(measured: PdfjsAssetMeasure): Record<string, number>;
