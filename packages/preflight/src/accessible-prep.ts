import { maskComments } from "./mask";
import {
  findDocumentMetadata,
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
const UNICODE_MATH_ENGINES: PreflightEngine[] = ["lualatex", "xelatex"];

const list = (names: readonly string[]) => names.join(", ");

export function prepareAccessibleSource(source: string, opts?: PrepOptions): PrepResult {
  const lang = opts?.lang ?? "en-US";
  const engine = opts?.engine ?? "unknown";
  const changes: PrepChange[] = [];
  let out = source;

  const needsHeaderRows = TABLE_ENVIRONMENT.test(maskComments(out));
  const existing = findDocumentMetadata(maskComments(out));
  let headerRowsSet = false;
  if (existing) {
    const keys = parseMetadataKeys(existing.body);
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
    if (needsHeaderRows) {
      const setup = keys.map.get("tagging-setup");
      if (setup === undefined) {
        keys.order.push("tagging-setup");
        keys.map.set("tagging-setup", "{table/header-rows={1}}");
        headerRowsSet = true;
      } else if (!HEADER_ROWS_KEY.test(setup)) {
        const inner = unwrapBraces(setup);
        keys.map.set("tagging-setup", `{${inner ? `${inner},` : ""}table/header-rows={1}}`);
        headerRowsSet = true;
      }
      touched = touched || headerRowsSet;
    }
    if (touched) {
      out = `${out.slice(0, existing.start)}\\DocumentMetadata{${serializeMetadataKeys(keys)}}${out.slice(existing.end)}`;
      changes.push({ kind: "modify", summary: message("prep.metadataUpdated") });
    }
  } else {
    const headerRows = needsHeaderRows ? ",tagging-setup={table/header-rows={1}}" : "";
    headerRowsSet = needsHeaderRows;
    out = `\\DocumentMetadata{lang=${lang},pdfstandard=ua-2,tagging=on${headerRows}}\n${out}`;
    changes.push({ kind: "add", summary: message("prep.metadataAdded") });
  }
  if (headerRowsSet) {
    changes.push({ kind: "info", summary: message("prep.headerRows") });
  }

  const masked = maskComments(out);
  const hasUnicodeMath = /\\usepackage(?:\[[^\]]{0,500}\])?\{unicode-math\}/.test(masked);
  const dc = /\\documentclass\s{0,20}(?:\[[^\]]{0,500}\])?\s{0,20}\{[^}]{0,500}\}/.exec(masked);
  if (!hasUnicodeMath && dc && UNICODE_MATH_ENGINES.includes(engine)) {
    const insertAt = dc.index + dc[0].length;
    out = `${out.slice(0, insertAt)}\n\\usepackage{unicode-math}${out.slice(insertAt)}`;
    changes.push({ kind: "add", summary: message("prep.unicodeMath") });
  }

  let altAdded = 0;
  out = out.replace(/\\includegraphics\s{0,20}(?:\[([^\]]{0,500})\])?\s{0,20}\{([^}]{0,2000})\}/g, (whole, optsGroup, file) => {
    const o = optsGroup ?? "";
    if (/\balt\s*=/.test(o)) return whole;
    altAdded++;
    const stub = `alt={TODO: describe ${file.trim()}}`;
    return o ? `\\includegraphics[${stub},${o}]{${file}}` : `\\includegraphics[${stub}]{${file}}`;
  });
  if (altAdded > 0) {
    changes.push({
      kind: "modify",
      summary: message("prep.altPlaceholders", { count: altAdded }),
    });
  }

  const hasTitle = /pdftitle\s*=/.test(maskComments(out));
  const showsTitle = /pdfdisplaydoctitle\s*=\s*true/i.test(maskComments(out));
  if (!hasTitle || !showsTitle) {
    changes.push({ kind: "warn", summary: message("prep.titleRequired") });
  }

  const verdicts = loadedPackagesOf(maskComments(out)).map(packageTaggingVerdict);
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

  changes.push({
    kind: "info",
    summary: message(engine === "lualatex" ? "prep.compileLua" : "prep.compileAny"),
  });

  return { output: out, changes };
}
