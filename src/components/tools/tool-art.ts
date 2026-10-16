import type { ToolId } from "@/lib/tool-catalog";

/** Every illustration under public/tool-art/ is 720x406, like the project-kind art. */
export const TOOL_ART_WIDTH = 720;
export const TOOL_ART_HEIGHT = 406;

/**
 * Tools with a header picture at public/tool-art/<id>.webp, drawn in the
 * style of the project-kind illustrations and kept under 10 KB each. A tool
 * missing from this list shows its icon on the gallery card instead.
 */
const TOOL_ART_IDS: ReadonlySet<ToolId> = new Set<ToolId>([
  "image-to-latex",
  "pdf-to-latex",
  "visual-typst-editor",
  "arxiv-to-latex",
  "arxiv-to-typst",
  "csv-to-typst",
  "equation-to-latex",
  "equation-to-typst",
  "excel-to-latex",
  "excel-to-typst",
  "html-to-latex",
  "html-to-typst",
  "image-to-typst",
  "latex-to-html",
  "latex-to-image",
  "latex-to-markdown",
  "latex-to-typst",
  "latex-to-word",
  "markdown-to-latex",
  "markdown-to-typst",
  "mermaid-to-latex",
  "mermaid-to-typst",
  "pdf-to-markdown",
  "pdf-to-typst",
  "table-to-latex",
  "typst-editor",
  "typst-to-html",
  "typst-to-latex",
  "typst-to-markdown",
  "typst-to-word",
  "word-to-latex",
  "word-to-typst",
  "bibtex",
  "literature-search",
  "lab-search",
  "deadlines",
  "arxiv-citation-generator",
  "bibliography-generator",
  "citation-generator",
  "citation-styles",
  "doi-to-bibtex",
  "isbn-to-bibtex",
  "pubmed-to-bibtex",
  "url-to-bibtex",
  "stats",
  "generators",
  "symbols",
]);

/** The header picture for a tool card, or undefined when the tool has none. */
export function toolArt(id: ToolId): string | undefined {
  return TOOL_ART_IDS.has(id) ? `/tool-art/${id}.webp` : undefined;
}
