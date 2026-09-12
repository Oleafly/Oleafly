/**
 * Assemble the conversion matrix table from the registry. Used by
 * scripts/generate-conversion-matrix.mjs to write docs/conversion-matrix.md
 * and by the test that keeps the doc in sync.
 */
import { REGISTRY, type ConversionRoute, type SourceFormat, type TargetFormat } from "./index.ts";

const SOURCE_ORDER: SourceFormat[] = [
  "latex",
  "markdown",
  "typst",
  "docx",
  "html",
  "pdf",
  "image",
  "equation",
  "csv",
  "mermaid",
  "arxiv",
  "doi",
  "isbn",
  "pmid",
  "ris",
  "endnote",
  "zotero",
  "bibtex",
];

const SOURCE_LABELS: Record<SourceFormat, string> = {
  latex: "LaTeX project",
  markdown: "Markdown",
  typst: "Typst",
  docx: "Word (.docx)",
  html: "HTML",
  pdf: "PDF",
  image: "Image (equation or photo)",
  equation: "Typed or photographed equation",
  csv: "CSV / XLSX",
  mermaid: "Mermaid diagram",
  arxiv: "arXiv id",
  doi: "DOI",
  isbn: "ISBN",
  pmid: "PMID",
  ris: "RIS",
  endnote: "EndNote XML",
  zotero: "Zotero RDF",
  bibtex: "BibTeX library",
};

const TARGET_ORDER: TargetFormat[] = [
  "pdf",
  "docx",
  "html",
  "markdown",
  "latex",
  "typst",
  "bibtex",
  "image",
];

const TARGET_LABELS: Record<TargetFormat, string> = {
  pdf: "PDF",
  docx: "DOCX",
  html: "HTML",
  markdown: "Markdown",
  latex: "LaTeX",
  typst: "Typst",
  bibtex: "BibTeX",
  image: "SVG / PNG",
};

export interface MatrixCell {
  source: SourceFormat;
  target: TargetFormat;
  routes: ConversionRoute[];
}

export interface Matrix {
  sources: SourceFormat[];
  targets: TargetFormat[];
  cells: MatrixCell[][];
}

export function buildMatrix(): Matrix {
  const cells = SOURCE_ORDER.map((source) =>
    TARGET_ORDER.map((target) => ({
      source,
      target,
      routes: REGISTRY.filter(
        (route) => route.source === source && route.target === target,
      ),
    })),
  );
  return { sources: SOURCE_ORDER, targets: TARGET_ORDER, cells };
}

function cellText(cell: MatrixCell): string {
  const { routes } = cell;
  if (routes.length === 0) {
    return "—";
  }
  return routes
    .map((route) => {
      switch (route.status) {
        case "available":
          return `✅ [${route.label}](#${route.id})`;
        case "existing":
          return `✅ [${route.label}](#${route.id})`;
        case "deferred":
          return `🟡 DEFERRED (${route.gapId ?? "?"}) [${route.label}](#${route.id})`;
      }
    })
    .join("<br>");
}

function routeSection(route: ConversionRoute): string {
  const lines: string[] = [`### ${route.id}`, ""];
  lines.push(`${route.blurb}`);
  lines.push("");
  const meta: [string, string][] = [
    ["Direction", route.direction],
    ["Engine", route.engine],
    ["Status", route.status],
    ["Surface", route.surface],
  ];
  if (route.gapId) {
    meta.push(["Gap", route.gapId]);
  }
  if (route.pandoc) {
    meta.push([
      "Pandoc route",
      `\`--from=${route.pandoc.from} --to=${route.pandoc.to}${route.pandoc.flags?.length ? ` ${route.pandoc.flags.join(" ")}` : ""}\``,
    ]);
  }
  if (route.status === "deferred" && route.deferredReason) {
    meta.push(["Deferred because", route.deferredReason]);
  }
  for (const [key, value] of meta) {
    lines.push(`- **${key}:** ${value}`);
  }
  lines.push("");
  return lines.join("\n");
}

export function generateMatrixMarkdown(): string {
  const matrix = buildMatrix();
  const header: string[] = [
    "# Conversion matrix",
    "",
    "Every document conversion Oleafly ships or has deliberately deferred,",
    "generated from `packages/conversion-registry` by `pnpm gen:conversion-matrix`.",
    "Edit the registry, not this file. Deferred routes carry a gap id; the",
    "[conversion roadmap](conversion-roadmap.md) lists everything deliberately",
    "unbuilt, with reasons.",
    "",
    "Legend: ✅ shipped · 🟡 deferred with a gap id · — not applicable.",
    "",
  ];
  const head = `| Source ↓ / Target → | ${matrix.targets.map((t) => TARGET_LABELS[t]).join(" | ")} |`;
  const divider = `|---|${matrix.targets.map(() => "---").join("|")}|`;
  const rows = matrix.sources.map((source, index) => {
    const cells = matrix.cells[index].map(cellText).join(" | ");
    return `| ${SOURCE_LABELS[source]} | ${cells} |`;
  });
  const deferred = REGISTRY.filter((route) => route.status === "deferred");
  const sections = [...header, head, divider, ...rows, "", "## Routes", ""];
  for (const source of matrix.sources) {
    const routes = REGISTRY.filter((route) => route.source === source);
    if (routes.length === 0) {
      continue;
    }
    sections.push(`## ${SOURCE_LABELS[source]}`, "");
    for (const route of routes) {
      sections.push(routeSection(route));
    }
  }
  if (deferred.length > 0) {
    sections.push("## Deferred", "");
    sections.push(
      ...deferred.map(
        (route) => `- **${route.id}** (${route.gapId}): ${route.deferredReason}`,
      ),
    );
    sections.push("");
  }
  return sections.join("\n");
}
