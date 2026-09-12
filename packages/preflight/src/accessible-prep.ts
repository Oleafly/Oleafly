import { maskComments } from "./mask";
import {
  findDocumentMetadata,
  type MetadataKeys,
  parseMetadataKeys,
  serializeMetadataKeys,
  unwrapBraces,
} from "./document-metadata";
import { loadedPackagesOf, packageTaggingVerdict } from "./tagging-status";
import { message, type MessageRef } from "./messages";
import type { PreflightEngine } from "./types";

export interface PrepChange {
  kind: "add" | "modify" | "warn" | "info";
  summary: MessageRef;
}

export interface PrepResult {
  output: string;
  changes: PrepChange[];
}

export interface PrepOptions {
  lang?: string;
  engine?: PreflightEngine;
}

const REQUIRED_META: Record<string, string> = { pdfstandard: "ua-2", tagging: "on" };
const TABLE_ENVIRONMENT = /\\begin\s*\{(?:tabular\*?|tabularx|longtable|tabulary)\}/;
const HEADER_ROWS_KEY = /table\/header-rows/;
const UNICODE_MATH_ENGINES = new Set<PreflightEngine>(["lualatex", "xelatex"]);

const list = (names: readonly string[]) => names.join(", ");

function applyRequiredKeys(keys: MetadataKeys, lang: string): boolean {
  let touched = false;
  if (!keys.map.has("lang")) {
    keys.order.push("lang");
    keys.map.set("lang", lang);
    touched = true;
  }
  for (const [key, value] of Object.entries(REQUIRED_META)) {
    if (!keys.map.has(key)) {
      keys.order.push(key);
      keys.map.set(key, value);
      touched = true;
    }
  }
  return touched;
}

function applyHeaderRows(keys: MetadataKeys): boolean {
  const setup = keys.map.get("tagging-setup");
  if (setup === undefined) {
    keys.order.push("tagging-setup");
    keys.map.set("tagging-setup", "{table/header-rows={1}}");
    return true;
  }
  if (HEADER_ROWS_KEY.test(setup)) return false;
  const inner = unwrapBraces(setup);
  const prefix = inner ? `${inner},` : "";
  keys.map.set("tagging-setup", `{${prefix}table/header-rows={1}}`);
  return true;
}

function applyDocumentMetadata(
  source: string,
  lang: string,
  needsHeaderRows: boolean,
): { out: string; changes: PrepChange[]; headerRowsSet: boolean } {
  const existing = findDocumentMetadata(maskComments(source));
  if (!existing) {
    const headerRows = needsHeaderRows ? ",tagging-setup={table/header-rows={1}}" : "";
    return {
      out: `\\DocumentMetadata{lang=${lang},pdfstandard=ua-2,tagging=on${headerRows}}\n${source}`,
      changes: [{ kind: "add", summary: message("prep.metadataAdded") }],
      headerRowsSet: needsHeaderRows,
    };
  }
  const keys = parseMetadataKeys(existing.body);
  let touched = applyRequiredKeys(keys, lang);
  let headerRowsSet = false;
  if (needsHeaderRows) {
    headerRowsSet = applyHeaderRows(keys);
    touched = touched || headerRowsSet;
  }
  if (!touched) return { out: source, changes: [], headerRowsSet };
  return {
    out: String.raw`${source.slice(0, existing.start)}\DocumentMetadata{${serializeMetadataKeys(keys)}}${source.slice(existing.end)}`,
    changes: [{ kind: "modify", summary: message("prep.metadataUpdated") }],
    headerRowsSet,
  };
}

function applyUnicodeMath(source: string, engine: PreflightEngine): string | null {
  const masked = maskComments(source);
  const hasUnicodeMath = /\\usepackage(?:\[[^\]]{0,500}\])?\{unicode-math\}/.test(masked);
  const dc = /\\documentclass\s{0,20}(?:\[[^\]]{0,500}\])?\s{0,20}\{[^}]{0,500}\}/.exec(masked);
  if (hasUnicodeMath || !dc || !UNICODE_MATH_ENGINES.has(engine)) return null;
  const insertAt = dc.index + dc[0].length;
  return `${source.slice(0, insertAt)}\n\\usepackage{unicode-math}${source.slice(insertAt)}`;
}

function applyAltPlaceholders(source: string): { out: string; added: number } {
  let added = 0;
  const out = source.replace(/\\includegraphics\s{0,20}(?:\[([^\]]{0,500})\])?\s{0,20}\{([^}]{0,2000})\}/g, (whole, optsGroup, file) => {
    const o = optsGroup ?? "";
    if (/\balt\s*=/.test(o)) return whole;
    added++;
    const stub = `alt={TODO: describe ${file.trim()}}`;
    return o
      ? String.raw`\includegraphics[${stub},${o}]{${file}}`
      : String.raw`\includegraphics[${stub}]{${file}}`;
  });
  return { out, added };
}

function packageChanges(source: string): PrepChange[] {
  const verdicts = loadedPackagesOf(maskComments(source)).map(packageTaggingVerdict);
  const changes: PrepChange[] = [];
  const incompatible = verdicts
    .filter((entry) => entry.status === "currently-incompatible" || entry.status === "no-support")
    .map((entry) => entry.name);
  if (incompatible.length > 0) {
    changes.push({
      kind: "warn",
      summary: message("prep.incompatiblePackages", {
        count: incompatible.length,
        packages: list(incompatible),
      }),
    });
  }
  const cautions = verdicts
    .filter(
      (entry) =>
        entry.status === "partially-compatible" ||
        entry.status === "unchecked" ||
        entry.status === "unknown",
    )
    .map((entry) => entry.name);
  if (cautions.length > 0) {
    changes.push({
      kind: "warn",
      summary: message("prep.cautionPackages", { packages: list(cautions) }),
    });
  }
  return changes;
}

export function prepareAccessibleSource(source: string, opts?: PrepOptions): PrepResult {
  const lang = opts?.lang ?? "en-US";
  const engine = opts?.engine ?? "unknown";
  const changes: PrepChange[] = [];

  const needsHeaderRows = TABLE_ENVIRONMENT.test(maskComments(source));
  const metadata = applyDocumentMetadata(source, lang, needsHeaderRows);
  let out = metadata.out;
  changes.push(...metadata.changes);
  if (metadata.headerRowsSet) {
    changes.push({ kind: "info", summary: message("prep.headerRows") });
  }

  const withUnicodeMath = applyUnicodeMath(out, engine);
  if (withUnicodeMath !== null) {
    out = withUnicodeMath;
    changes.push({ kind: "add", summary: message("prep.unicodeMath") });
  }

  const alt = applyAltPlaceholders(out);
  out = alt.out;
  if (alt.added > 0) {
    changes.push({
      kind: "modify",
      summary: message("prep.altPlaceholders", { count: alt.added }),
    });
  }

  const hasTitle = /pdftitle\s*=/.test(maskComments(out));
  const showsTitle = /pdfdisplaydoctitle\s*=\s*true/i.test(maskComments(out));
  if (!hasTitle || !showsTitle) {
    changes.push({ kind: "warn", summary: message("prep.titleRequired") });
  }

  changes.push(...packageChanges(out), {
    kind: "info",
    summary: message(engine === "lualatex" ? "prep.compileLua" : "prep.compileAny"),
  });

  return { output: out, changes };
}
