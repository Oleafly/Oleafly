import type { ComponentType } from "react";
import {
  ArrowLeftRight,
  Bookmark,
  BookOpen,
  BookOpenText,
  Braces,
  Calculator,
  ClipboardClock,
  FileCode2,
  FileInput,
  FileOutput,
  FileSpreadsheet,
  FileText,
  FileType2,
  Image as ImageIcon,
  Hash,
  ListChecks,
  Link2,
  Network,
  School,
  ShieldCheck,
  Sigma,
  Sparkles,
  Table2,
  TextCursorInput,
} from "lucide-react";
import { ArxivIcon } from "@/components/icons/ArxivIcon";
import { i18n } from "@/i18n";
import type { ConverterToolId } from "@/lib/converter-types";
import type { ReferenceToolId } from "@/lib/reference-tools";
import type { HomePage } from "@/store/home-view";

export type ToolId =
  | ConverterToolId
  | ReferenceToolId
  | "pdf-to-latex"
  | "visual-typst-editor"
  | "equation"
  | "latex-to-image"
  | "table"
  | "table-to-latex"
  | "typst-editor"
  | "bibtex"
  | "lab-search"
  | "literature-search"
  | "deadlines"
  | "stats"
  | "generators"
  | "symbols";

export type ToolCategory =
  | "converters"
  | "validate"
  | "research"
  | "references"
  | "statistics"
  | "write";

export type ToolDestination =
  | { kind: "page"; page: HomePage }
  | { kind: "converter"; converter: ConverterToolId }
  | { kind: "reference"; tool: ReferenceToolId }
  | { kind: "typst-project"; mode: "visual" | "source" };

export interface ToolDefinition {
  id: ToolId;
  name: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
  tags: readonly string[];
  category: ToolCategory;
  destination: ToolDestination;
  slash: readonly [string, ...string[]];
  tone: "rose" | "violet" | "emerald" | "cyan" | "blue" | "sky" | "amber";
}

export const TOOL_CATEGORY_ORDER = [
  "converters",
  "validate",
  "research",
  "references",
  "statistics",
  "write",
] as const;

function converter(
  definition: Omit<ToolDefinition, "category" | "destination"> & {
    converter: ConverterToolId;
  },
): ToolDefinition {
  const { converter: converterId, ...tool } = definition;
  return {
    ...tool,
    category: "converters",
    destination: { kind: "converter", converter: converterId },
  };
}

function reference(
  definition: Omit<ToolDefinition, "category" | "destination"> & {
    tool: ReferenceToolId;
  },
): ToolDefinition {
  const { tool: referenceTool, ...definitionWithoutTool } = definition;
  return {
    ...definitionWithoutTool,
    category: "references",
    destination: { kind: "reference", tool: referenceTool },
  };
}

export const TOOL_DEFINITIONS: readonly ToolDefinition[] = [
  converter({
    id: "image-to-latex",
    converter: "image-to-latex",
    name: "Image to LaTeX",
    description: "Turn an image of notes, equations, or a table into editable LaTeX.",
    icon: ImageIcon,
    tags: ["Images", "On-device model", "No project needed"],
    slash: ["image-to-latex"],
    tone: "blue",
  }),
  {
    id: "pdf-to-latex",
    name: "PDF to LaTeX",
    description: "Reconstruct a PDF as LaTeX and keep its extracted figures together.",
    icon: FileInput,
    tags: ["Text layer", "Figures", "Local"],
    category: "converters",
    destination: { kind: "page", page: "pdf-import" },
    slash: ["pdf-to-latex", "pdf-import"],
    tone: "rose",
  },
  {
    id: "visual-typst-editor",
    name: "Visual Typst Editor",
    description: "Start a Typst document in Oleafly's project editor and live preview.",
    icon: TextCursorInput,
    tags: ["Project editor", "Live preview", "Local"],
    category: "converters",
    destination: { kind: "typst-project", mode: "visual" },
    slash: ["visual-typst-editor", "typst-visual"],
    tone: "sky",
  },
  converter({
    id: "arxiv-to-latex",
    converter: "arxiv-to-latex",
    name: "arXiv to LaTeX",
    description: "Download an arXiv source bundle, or open a saved archive from disk.",
    icon: ArxivIcon,
    tags: ["Source archive", "ID needs network", "Offline file mode"],
    slash: ["arxiv-to-latex", "arxiv-source"],
    tone: "rose",
  }),
  converter({
    id: "equation-to-latex",
    converter: "equation-to-latex",
    name: "Equation to LaTeX",
    description: "Convert a typed equation or equation image into clean LaTeX math.",
    icon: Sigma,
    tags: ["Text or image", "Math", "On-device model"],
    slash: ["equation-to-latex", "math-to-latex"],
    tone: "violet",
  }),
  converter({
    id: "excel-to-latex",
    converter: "excel-to-latex",
    name: "Excel to LaTeX",
    description: "Convert an Excel, CSV, or TSV sheet into an escaped LaTeX table.",
    icon: FileSpreadsheet,
    tags: ["XLSX", "CSV and TSV", "Local"],
    slash: ["excel-to-latex", "spreadsheet-to-latex"],
    tone: "emerald",
  }),
  converter({
    id: "html-to-latex",
    converter: "html-to-latex",
    name: "HTML to LaTeX",
    description: "Convert pasted HTML into a standalone LaTeX document.",
    icon: FileCode2,
    tags: ["HTML", "Pandoc", "Local"],
    slash: ["html-to-latex"],
    tone: "amber",
  }),
  converter({
    id: "image-to-typst",
    converter: "image-to-typst",
    name: "Image to Typst",
    description: "Turn an image of notes, equations, or a table into editable Typst.",
    icon: ImageIcon,
    tags: ["Images", "On-device model", "No project needed"],
    slash: ["image-to-typst"],
    tone: "sky",
  }),
  converter({
    id: "latex-to-html",
    converter: "latex-to-html",
    name: "LaTeX to HTML",
    description: "Convert LaTeX to standalone, accessible HTML with MathML equations.",
    icon: FileCode2,
    tags: ["MathML", "Standalone HTML", "Local"],
    slash: ["latex-to-html"],
    tone: "amber",
  }),
  {
    id: "latex-to-image",
    name: "LaTeX to Image",
    description: "Render a LaTeX equation and export a crisp PNG or SVG.",
    icon: FileOutput,
    tags: ["PNG", "SVG", "Live preview"],
    category: "converters",
    destination: { kind: "page", page: "equation" },
    slash: ["latex-to-image", "latex-preview"],
    tone: "violet",
  },
  converter({
    id: "latex-to-markdown",
    converter: "latex-to-markdown",
    name: "LaTeX to Markdown",
    description: "Convert a LaTeX document into portable Markdown.",
    icon: FileText,
    tags: ["Markdown", "Pandoc", "Project optional"],
    slash: ["latex-to-markdown"],
    tone: "cyan",
  }),
  converter({
    id: "latex-to-typst",
    converter: "latex-to-typst",
    name: "LaTeX to Typst",
    description: "Convert LaTeX into Typst source you can copy, save, or open as a project.",
    icon: ArrowLeftRight,
    tags: ["Typst", "Pandoc", "Project optional"],
    slash: ["latex-to-typst"],
    tone: "sky",
  }),
  converter({
    id: "latex-to-word",
    converter: "latex-to-word",
    name: "LaTeX to Word",
    description: "Create a Word document with equations stored as native Word math.",
    icon: FileType2,
    tags: ["DOCX", "Native math", "Local"],
    slash: ["latex-to-word", "latex-to-docx"],
    tone: "blue",
  }),
  converter({
    id: "markdown-to-latex",
    converter: "markdown-to-latex",
    name: "Markdown to LaTeX",
    description: "Convert Markdown notes into a standalone LaTeX document.",
    icon: FileText,
    tags: ["Markdown", "Pandoc", "Project optional"],
    slash: ["markdown-to-latex"],
    tone: "cyan",
  }),
  converter({
    id: "markdown-to-typst",
    converter: "markdown-to-typst",
    name: "Markdown to Typst",
    description: "Convert Markdown notes into Typst source instantly.",
    icon: FileText,
    tags: ["Markdown", "Pandoc", "Project optional"],
    slash: ["markdown-to-typst"],
    tone: "sky",
  }),
  converter({
    id: "mermaid-to-latex",
    converter: "mermaid-to-latex",
    name: "Mermaid to LaTeX",
    description: "Convert a Mermaid flowchart into editable TikZ code.",
    icon: Network,
    tags: ["Flowcharts", "TikZ", "Local"],
    slash: ["mermaid-to-latex", "mermaid-to-tikz"],
    tone: "violet",
  }),
  converter({
    id: "pdf-to-markdown",
    converter: "pdf-to-markdown",
    name: "PDF to Markdown",
    description: "Extract a PDF's text layer, equations, and figures into Markdown.",
    icon: FileInput,
    tags: ["Text layer", "Figures", "Local"],
    slash: ["pdf-to-markdown"],
    tone: "rose",
  }),
  converter({
    id: "pdf-to-typst",
    converter: "pdf-to-typst",
    name: "PDF to Typst",
    description: "Extract a PDF's text layer, equations, and figures into Typst.",
    icon: FileInput,
    tags: ["Text layer", "Figures", "Local"],
    slash: ["pdf-to-typst"],
    tone: "rose",
  }),
  {
    id: "table-to-latex",
    name: "Table to LaTeX",
    description: "Build a LaTeX table in a visual row-and-column editor.",
    icon: Table2,
    tags: ["Visual editor", "booktabs", "Local"],
    category: "converters",
    destination: { kind: "page", page: "table" },
    slash: ["table-to-latex", "latex-table", "table-generator"],
    tone: "cyan",
  },
  {
    id: "typst-editor",
    name: "Typst Editor",
    description: "Start a Typst project with source editing, live preview, and PDF export.",
    icon: Braces,
    tags: ["Project editor", "PDF export", "Local"],
    category: "converters",
    destination: { kind: "typst-project", mode: "source" },
    slash: ["typst-editor", "new-typst"],
    tone: "sky",
  },
  converter({
    id: "typst-to-latex",
    converter: "typst-to-latex",
    name: "Typst to LaTeX",
    description: "Convert Typst markup into LaTeX for journals and submissions.",
    icon: ArrowLeftRight,
    tags: ["LaTeX", "Pandoc", "Project optional"],
    slash: ["typst-to-latex"],
    tone: "sky",
  }),
  converter({
    id: "word-to-latex",
    converter: "word-to-latex",
    name: "Word to LaTeX",
    description: "Convert a Word document into LaTeX and keep extracted media together.",
    icon: FileType2,
    tags: ["DOCX", "Media", "Project optional"],
    slash: ["word-to-latex", "docx-to-latex"],
    tone: "blue",
  }),
  {
    id: "bibtex",
    name: "BibTeX Validator",
    description: "Validate .bib files for syntax errors and missing required fields.",
    icon: ShieldCheck,
    tags: ["12 entry types", "Required fields", "Duplicate keys"],
    category: "validate",
    destination: { kind: "page", page: "bibtex" },
    slash: ["bibtex-validator", "bibtex"],
    tone: "emerald",
  },
  {
    id: "literature-search",
    name: "Find Citations",
    description: "Find relevant papers across scholarly indexes, scan a draft, and export BibTeX.",
    icon: Sparkles,
    tags: ["Semantic search", "Document scan", "BibTeX export"],
    category: "references",
    destination: { kind: "page", page: "literature-search" },
    slash: ["find-citations", "citations-search", "citation-search", "literature-search"],
    tone: "amber",
  },
  {
    id: "lab-search",
    name: "Lab Search",
    description: "Find research institutions worldwide through the OpenAlex directory.",
    icon: School,
    tags: ["Institution records", "Country filter", "ROR links"],
    category: "research",
    destination: { kind: "page", page: "lab-search" },
    slash: ["lab-search", "institution-search"],
    tone: "sky",
  },
  {
    id: "deadlines",
    name: "Conference Deadlines",
    description: "View countdowns and filters for computer science conference deadlines.",
    icon: ClipboardClock,
    tags: ["Live countdown", "Field filters", "Conference calendar"],
    category: "research",
    destination: { kind: "page", page: "deadlines" },
    slash: ["conference-deadlines", "deadlines"],
    tone: "amber",
  },
  reference({
    id: "arxiv-citation-generator",
    tool: "arxiv-citation-generator",
    name: "arXiv Citation Generator",
    description: "Look up an arXiv paper, then format and export its citation in eight styles.",
    icon: ArxivIcon,
    tags: ["Eight styles", "BibTeX", "Manual mode works offline"],
    slash: ["arxiv-citation", "cite-arxiv"],
    tone: "amber",
  }),
  reference({
    id: "bibliography-generator",
    tool: "bibliography-generator",
    name: "Bibliography Generator",
    description: "Build, validate, sort, and export a complete bibliography from structured details or BibTeX.",
    icon: Bookmark,
    tags: ["Batch references", "Eight styles", "Local formatting"],
    slash: ["bibliography-generator", "make-bibliography"],
    tone: "amber",
  }),
  reference({
    id: "citation-generator",
    tool: "citation-generator",
    name: "Citation Generator",
    description: "Turn article details or a scholarly identifier into a formatted citation and BibTeX.",
    icon: BookOpen,
    tags: ["Structured editor", "Identifier lookup", "Local formatting"],
    slash: ["citation-generator", "make-citation"],
    tone: "amber",
  }),
  reference({
    id: "citation-styles",
    tool: "citation-styles",
    name: "Citation Generators by Style",
    description: "Compare one reference across APA, MLA, Chicago, IEEE, Harvard, Vancouver, AMA, and ACS.",
    icon: BookOpenText,
    tags: ["Eight styles", "Side-by-side", "Local formatting"],
    slash: ["citation-styles", "citation-style-generator"],
    tone: "amber",
  }),
  reference({
    id: "doi-to-bibtex",
    tool: "doi-to-bibtex",
    name: "DOI to BibTeX",
    description: "Retrieve a DOI record, review every field, and export clean BibTeX.",
    icon: Link2,
    tags: ["DOI lookup", "Editable fields", "BibTeX"],
    slash: ["doi-to-bibtex", "doi-citation"],
    tone: "amber",
  }),
  reference({
    id: "isbn-to-bibtex",
    tool: "isbn-to-bibtex",
    name: "ISBN to BibTeX",
    description: "Retrieve book metadata from an ISBN, correct it, and export BibTeX.",
    icon: Hash,
    tags: ["ISBN-10 and ISBN-13", "Editable fields", "BibTeX"],
    slash: ["isbn-to-bibtex", "isbn-citation"],
    tone: "amber",
  }),
  reference({
    id: "pubmed-to-bibtex",
    tool: "pubmed-to-bibtex",
    name: "PubMed to BibTeX",
    description: "Retrieve a PubMed record from its PMID, review it, and export BibTeX.",
    icon: Hash,
    tags: ["PMID lookup", "Medical literature", "BibTeX"],
    slash: ["pubmed-to-bibtex", "pmid-to-bibtex"],
    tone: "amber",
  }),
  reference({
    id: "url-to-bibtex",
    tool: "url-to-bibtex",
    name: "URL to BibTeX",
    description: "Recognize DOI, arXiv, and PubMed links, or build a safe editable webpage citation.",
    icon: Link2,
    tags: ["Smart links", "Editable metadata", "Local fallback"],
    slash: ["url-to-bibtex", "webpage-citation"],
    tone: "amber",
  }),
  {
    id: "stats",
    name: "Statistics Calculators",
    description: "Calculate p-values, sample sizes, and confidence intervals locally.",
    icon: Calculator,
    tags: ["p-value", "Sample size", "Confidence interval"],
    category: "statistics",
    destination: { kind: "page", page: "stats" },
    slash: ["stats", "statistics", "p-value"],
    tone: "blue",
  },
  {
    id: "generators",
    name: "Writing Generators",
    description: "Draft an abstract, summary, paraphrase, or thesis outline with the assistant.",
    icon: ListChecks,
    tags: ["Abstract", "Summarize", "Paraphrase", "Thesis"],
    category: "write",
    destination: { kind: "page", page: "generators" },
    slash: ["generators", "abstract", "paraphrase"],
    tone: "violet",
  },
  {
    id: "symbols",
    name: "Symbol Reference",
    description: "Browse LaTeX symbols and insert one at the current cursor.",
    icon: BookOpenText,
    tags: ["Greek", "Arrows", "Cheatsheet", "Insert at cursor"],
    category: "references",
    destination: { kind: "page", page: "symbols" },
    slash: ["symbols", "cheatsheet", "greek-letters"],
    tone: "cyan",
  },
];

export function toolName(id: ToolId): string {
  switch (id) {
    case "pdf-to-latex":
      return i18n.t(($) => $.researchTools.tools.pdfToLatex.name);
    case "equation":
      return i18n.t(($) => $.researchTools.tools.equation.name);
    case "bibtex":
      return i18n.t(($) => $.researchTools.tools.bibtex.name);
    case "table":
      return i18n.t(($) => $.researchTools.tools.table.name);
    case "literature-search":
      return i18n.t(($) => $.researchTools.tools.literatureSearch.name);
    case "lab-search":
      return i18n.t(($) => $.researchTools.tools.labSearch.name);
    case "deadlines":
      return i18n.t(($) => $.researchTools.tools.deadlines.name);
    default:
      return toolById(id).name;
  }
}

export function toolDescription(id: ToolId): string {
  switch (id) {
    case "pdf-to-latex":
      return i18n.t(($) => $.researchTools.tools.pdfToLatex.description);
    case "equation":
      return i18n.t(($) => $.researchTools.tools.equation.description);
    case "bibtex":
      return i18n.t(($) => $.researchTools.tools.bibtex.description);
    case "table":
      return i18n.t(($) => $.researchTools.tools.table.description);
    case "literature-search":
      return i18n.t(($) => $.researchTools.tools.literatureSearch.description);
    case "lab-search":
      return i18n.t(($) => $.researchTools.tools.labSearch.description);
    case "deadlines":
      return i18n.t(($) => $.researchTools.tools.deadlines.description);
    default:
      return toolById(id).description;
  }
}

export function toolTags(id: ToolId): string[] {
  switch (id) {
    case "pdf-to-latex":
      return [
        i18n.t(($) => $.researchTools.tools.pdfToLatex.tagMath),
        i18n.t(($) => $.researchTools.tools.pdfToLatex.tagFigures),
        i18n.t(($) => $.researchTools.tools.pdfToLatex.tagClientSide),
      ];
    case "equation":
      return [
        i18n.t(($) => $.researchTools.tools.equation.tagKatex),
        i18n.t(($) => $.researchTools.tools.equation.tagModes),
        i18n.t(($) => $.researchTools.tools.equation.tagCopy),
      ];
    case "bibtex":
      return [
        i18n.t(($) => $.researchTools.tools.bibtex.tagEntryTypes),
        i18n.t(($) => $.researchTools.tools.bibtex.tagRequiredFields),
        i18n.t(($) => $.researchTools.tools.bibtex.tagDuplicateKeys),
      ];
    case "table":
      return [
        i18n.t(($) => $.researchTools.tools.table.tagVisualEditor),
        i18n.t(($) => $.researchTools.tools.table.tagBooktabs),
        i18n.t(($) => $.researchTools.tools.table.tagExport),
      ];
    case "literature-search":
      return [
        i18n.t(($) => $.researchTools.tools.literatureSearch.tagIndexes),
        i18n.t(($) => $.researchTools.tools.literatureSearch.tagFromDocument),
        i18n.t(($) => $.researchTools.tools.literatureSearch.tagReview),
        i18n.t(($) => $.researchTools.tools.literatureSearch.tagSaved),
      ];
    case "lab-search":
      return [
        i18n.t(($) => $.researchTools.tools.labSearch.tagRecords),
        i18n.t(($) => $.researchTools.tools.labSearch.tagCountryFilter),
        i18n.t(($) => $.researchTools.tools.labSearch.tagRor),
      ];
    case "deadlines":
      return [
        i18n.t(($) => $.researchTools.tools.deadlines.tagCountdown),
        i18n.t(($) => $.researchTools.tools.deadlines.tagFieldFilters),
        i18n.t(($) => $.researchTools.tools.deadlines.tagSource),
      ];
    default:
      return [...toolById(id).tags];
  }
}

export function toolCategoryLabel(category: ToolCategory): string {
  switch (category) {
    case "converters":
      return i18n.t(($) => $.researchTools.tools.category.converters);
    case "validate":
      return i18n.t(($) => $.researchTools.tools.category.validate);
    case "research":
      return i18n.t(($) => $.researchTools.tools.category.research);
    case "references":
      return i18n.t(($) => $.researchTools.tools.category.references);
    case "statistics":
      return i18n.t(($) => $.researchTools.tools.category.statistics);
    case "write":
      return i18n.t(($) => $.researchTools.tools.category.write);
  }
}

export function toolById(id: ToolId): ToolDefinition {
  const tool = TOOL_DEFINITIONS.find((candidate) => candidate.id === id);
  if (!tool) throw new Error(`Unknown tool: ${id}`);
  return tool;
}
