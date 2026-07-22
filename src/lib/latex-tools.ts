// Pure logic behind the LaTeX tools view: BibTeX parsing/validation and
// LaTeX table generation. Kept UI-free so it is unit-testable.

const SPEC: Record<string, { required: string[][]; optional: string[] }> = {
  article: {
    required: [["author"], ["title"], ["journal"], ["year"]],
    optional: ["volume", "number", "pages", "month", "doi", "url"],
  },
  book: {
    required: [["title"], ["publisher"], ["year"], ["author", "editor"]],
    optional: ["volume", "series", "edition", "address", "isbn", "doi"],
  },
  inproceedings: {
    required: [["author"], ["title"], ["booktitle"], ["year"]],
    optional: ["pages", "address", "publisher", "doi"],
  },
  conference: {
    required: [["author"], ["title"], ["booktitle"], ["year"]],
    optional: ["pages", "address", "publisher"],
  },
  phdthesis: {
    required: [["author"], ["title"], ["school"], ["year"]],
    optional: ["address", "month", "type", "doi"],
  },
  mastersthesis: {
    required: [["author"], ["title"], ["school"], ["year"]],
    optional: ["address", "month", "type"],
  },
  techreport: {
    required: [["author"], ["title"], ["institution"], ["year"]],
    optional: ["type", "number", "address", "month"],
  },
  misc: {
    required: [],
    optional: ["author", "title", "year", "url", "note", "howpublished"],
  },
  unpublished: {
    required: [["author"], ["title"], ["note"]],
    optional: ["year", "month"],
  },
  proceedings: {
    required: [["title"], ["year"]],
    optional: ["editor", "publisher", "address", "volume"],
  },
  manual: {
    required: [["title"]],
    optional: ["author", "organization", "year", "edition"],
  },
  incollection: {
    required: [["author"], ["title"], ["booktitle"], ["publisher"], ["year"]],
    optional: ["editor", "chapter", "pages", "address"],
  },
};

export interface BibEntry {
  type: string;
  key: string;
  fields: Record<string, string>;
}

export interface BibFinding {
  key: string;
  type: string;
  level: "error" | "warning" | "ok";
  messages: string[];
}

/** Tolerant BibTeX parser: balanced-brace field values, quoted values, bare numbers. */
export function parseBib(src: string): { entries: BibEntry[]; parseErrors: string[] } {
  const entries: BibEntry[] = [];
  const parseErrors: string[] = [];
  let i = 0;
  while (i < src.length) {
    const at = src.indexOf("@", i);
    if (at < 0) break;
    const typeMatch = src.slice(at + 1).match(/^([a-zA-Z]+)\s*\{/);
    if (!typeMatch) {
      i = at + 1;
      continue;
    }
    const type = typeMatch[1].toLowerCase();
    let p = at + 1 + typeMatch[0].length;
    if (type === "comment" || type === "preamble" || type === "string") {
      i = p;
      continue;
    }
    const keyEnd = src.slice(p).search(/[,}]/);
    if (keyEnd < 0) {
      parseErrors.push(`Unterminated entry near character ${at}`);
      break;
    }
    const key = src.slice(p, p + keyEnd).trim();
    p += keyEnd;
    const fields: Record<string, string> = {};
    let depth = 1;
    while (p < src.length && depth > 0) {
      while (p < src.length && /[\s,]/.test(src[p])) p++;
      if (src[p] === "}") {
        depth--;
        p++;
        break;
      }
      const nameMatch = src.slice(p).match(/^([a-zA-Z][a-zA-Z0-9_-]*)\s*=\s*/);
      if (!nameMatch) {
        const close = src.indexOf("}", p);
        parseErrors.push(`Could not read fields of "${key || type}"`);
        p = close < 0 ? src.length : close + 1;
        depth = 0;
        break;
      }
      const name = nameMatch[1].toLowerCase();
      p += nameMatch[0].length;
      let value = "";
      if (src[p] === "{") {
        let braces = 1;
        p++;
        const start = p;
        while (p < src.length && braces > 0) {
          if (src[p] === "{") braces++;
          else if (src[p] === "}") braces--;
          if (braces > 0) p++;
        }
        value = src.slice(start, p);
        p++;
      } else if (src[p] === '"') {
        p++;
        const start = p;
        while (p < src.length && src[p] !== '"') p++;
        value = src.slice(start, p);
        p++;
      } else {
        const start = p;
        while (p < src.length && !/[\s,}]/.test(src[p])) p++;
        value = src.slice(start, p);
      }
      fields[name] = value.replace(/\s+/g, " ").trim();
    }
    if (key) entries.push({ type, key, fields });
    else parseErrors.push(`Entry of type @${type} is missing a citation key`);
    i = p;
  }
  return { entries, parseErrors };
}

export function validateBib(entries: BibEntry[]): BibFinding[] {
  const findings: BibFinding[] = [];
  const seenKeys = new Map<string, number>();
  const doiToKeys = new Map<string, string[]>();
  for (const e of entries) {
    seenKeys.set(e.key, (seenKeys.get(e.key) ?? 0) + 1);
    const doi = e.fields.doi?.toLowerCase();
    if (doi) doiToKeys.set(doi, [...(doiToKeys.get(doi) ?? []), e.key]);
  }
  for (const e of entries) {
    const messages: string[] = [];
    let level: BibFinding["level"] = "ok";
    const spec = SPEC[e.type];
    if (!spec) {
      messages.push(`Unknown entry type @${e.type}`);
      level = "warning";
    } else {
      for (const group of spec.required) {
        if (!group.some((f) => e.fields[f]?.length)) {
          messages.push(`Missing required field: ${group.join(" or ")}`);
          level = "error";
        }
      }
      const known = new Set([...spec.required.flat(), ...spec.optional]);
      for (const f of Object.keys(e.fields)) {
        if (!known.has(f) && !["keywords", "abstract", "note", "url", "doi"].includes(f)) {
          messages.push(`Unusual field for @${e.type}: ${f}`);
          if (level === "ok") level = "warning";
        }
      }
    }
    if ((seenKeys.get(e.key) ?? 0) > 1) {
      messages.push("Duplicate citation key");
      level = "error";
    }
    const doi = e.fields.doi?.toLowerCase();
    if (doi && (doiToKeys.get(doi)?.length ?? 0) > 1) {
      messages.push(
        `Duplicate DOI shared with: ${doiToKeys
          .get(doi)
          ?.filter((k) => k !== e.key)
          .join(", ")}`,
      );
      if (level === "ok") level = "warning";
    }
    const year = e.fields.year;
    if (year && !/^\d{4}$/.test(year)) {
      messages.push(`Year "${year}" is not a four digit number`);
      if (level === "ok") level = "warning";
    }
    findings.push({ key: e.key, type: e.type, level, messages });
  }
  return findings;
}

export type TableAlign = "l" | "c" | "r";

export function buildLatexTable(
  cells: string[][],
  aligns: TableAlign[],
  opts: { booktabs: boolean; headerRow: boolean; caption: string },
): string {
  const colSpec = aligns.join("");
  const esc = (s: string) => s.replace(/([%$&#_{}])/g, "\\$1");
  const row = (r: string[]) => `    ${r.map(esc).join(" & ")} \\\\`;
  const lines: string[] = [];
  lines.push("\\begin{table}[htbp]");
  lines.push("  \\centering");
  if (opts.caption) lines.push(`  \\caption{${esc(opts.caption)}}`);
  lines.push(`  \\begin{tabular}{${colSpec}}`);
  if (opts.booktabs) {
    lines.push("    \\toprule");
    if (opts.headerRow && cells.length > 0) {
      lines.push(row(cells[0]));
      lines.push("    \\midrule");
      for (const r of cells.slice(1)) lines.push(row(r));
    } else {
      for (const r of cells) lines.push(row(r));
    }
    lines.push("    \\bottomrule");
  } else {
    lines.push("    \\hline");
    for (const [i, r] of cells.entries()) {
      lines.push(row(r));
      if (i === 0 && opts.headerRow) lines.push("    \\hline");
    }
    lines.push("    \\hline");
  }
  lines.push("  \\end{tabular}");
  lines.push("\\end{table}");
  return lines.join("\n");
}

export function resizeTable(cells: string[][], rows: number, cols: number): string[][] {
  return Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) => cells[r]?.[c] ?? ""),
  );
}
