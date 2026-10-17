import { invoke } from "@tauri-apps/api/core";
import type { ProjectMeta, TypstOptionsDescriptor } from "@oleafly/backend-port";

export type TypstInputs = Record<string, string>;

export interface TypstProjectOptions {
  fontPaths: string[];
  systemFonts: boolean;
  reproducible: boolean;
  inputs: TypstInputs;
  variants: Record<string, TypstInputs>;
}

export interface TypstOptionsUpdate {
  systemFonts?: boolean;
  reproducible?: boolean;
  fontPaths?: string[];
  inputs?: TypstInputs;
  variants?: Record<string, TypstInputs>;
}

export type TypstFontSourceKind = "project" | "pack" | "system" | "embedded";

export interface TypstFontSource {
  kind: TypstFontSourceKind;
  path: string | null;
}

export interface TypstFontEntry {
  name: string;
  sources: TypstFontSource[];
}

export interface TypstFontList {
  version: string;
  sourcesListed: boolean;
  systemFonts: boolean;
  families: TypstFontEntry[];
}

export type TypstExportFormat = "pdf" | "png" | "svg" | "html";

export interface TypstExportRequest {
  format: TypstExportFormat;
  ppi?: number | null;
  pages?: string | null;
  pdfStandard?: string | null;
  variant?: string | null;
}

export interface TypstExportResult {
  files: string[];
}

export const typstProjectOptions = (projectId: string) =>
  invoke<TypstProjectOptions>("typst_project_options", { projectId });

export const setTypstProjectOptions = (projectId: string, update: TypstOptionsUpdate) =>
  invoke<ProjectMeta>("set_typst_project_options", { projectId, update });

export const typstProjectFonts = (projectId: string) =>
  invoke<TypstFontList>("typst_project_fonts", { projectId });

export const exportTypstDocument = (
  projectId: string,
  mainDoc: string,
  request: TypstExportRequest,
  dest: string,
) => invoke<TypstExportResult>("export_typst_document", { projectId, mainDoc, request, dest });

const HTML_EXPORT = "html";
const TAGGED_BY_DEFAULT = /^0\.(?:1[4-9]|[2-9]\d)\.|^[1-9]\d*\./u;

export function typstSupports(options: TypstOptionsDescriptor | null | undefined, flag: string): boolean {
  return options?.flags.includes(flag) ?? false;
}

export function typstHtmlExport(options: TypstOptionsDescriptor | null | undefined): boolean {
  return (options?.output_formats.includes(HTML_EXPORT) ?? false) && typstSupports(options, "--features");
}

export function typstTagsPdfByDefault(version: string | null | undefined): boolean {
  return Boolean(version && TAGGED_BY_DEFAULT.test(version.trim()));
}

const PDF_STANDARD_ORDER = ["a-2b", "a-3b", "a-1b", "a-1a", "a-2u", "a-2a", "a-3u", "a-3a", "a-4", "a-4f", "a-4e", "ua-1"];

export function typstArchivalStandards(options: TypstOptionsDescriptor | null | undefined): string[] {
  const offered = new Set(options?.pdf_standards ?? []);
  return PDF_STANDARD_ORDER.filter((standard) => offered.has(standard));
}

export function typstStandardLabel(standard: string): string {
  if (standard.startsWith("ua-")) return `PDF/UA-${standard.slice(3)}`;
  if (standard.startsWith("a-")) return `PDF/A-${standard.slice(2)}`;
  return `PDF ${standard}`;
}

const MAX_PAGE = 1_000_000;

function pageNumber(text: string): number | null | undefined {
  if (text === "") return null;
  if (!/^\d+$/u.test(text)) return undefined;
  const value = Number(text);
  return value >= 1 && value <= MAX_PAGE ? value : undefined;
}

export function validTypstPageRanges(text: string): boolean {
  const compact = text.replaceAll(/\s+/gu, "");
  if (!compact) return false;
  return compact.split(",").every((part) => {
    const dash = part.indexOf("-");
    if (dash === -1) return typeof pageNumber(part) === "number";
    const first = pageNumber(part.slice(0, dash));
    const last = pageNumber(part.slice(dash + 1));
    if (first === undefined || last === undefined) return false;
    if (first === null && last === null) return false;
    return first === null || last === null || first <= last;
  });
}
