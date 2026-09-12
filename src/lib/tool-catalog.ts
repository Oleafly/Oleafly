import type { ComponentType } from "react";
import {
  Archive,
  ArrowLeftRight,
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
  LibraryBig,
  ListChecks,
  Network,
  School,
  ShieldCheck,
  Sigma,
  Table2,
  TextCursorInput,
} from "lucide-react";
import type { ConverterToolId } from "@/lib/converter-types";
import type { HomePage } from "@/store/home-view";

export type ToolId =
  | ConverterToolId
  | "pdf-to-latex"
  | "visual-typst-editor"
  | "latex-to-image"
  | "table-to-latex"
  | "typst-editor"
  | "bibtex"
  | "lab-search"
  | "literature-search"
  | "deadlines"
  | "stats"
  | "generators"
  | "symbols";

export type ToolDestination =
  | { kind: "page"; page: HomePage }
  | { kind: "converter"; converter: ConverterToolId }
  | { kind: "typst-project"; mode: "visual" | "source" };

export interface ToolDefinition {
  id: ToolId;
  name: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
  tags: readonly string[];
  category: string;
  destination: ToolDestination;
  slash: readonly [string, ...string[]];
  tone: "rose" | "violet" | "emerald" | "cyan" | "blue" | "sky" | "amber";
}

export const TOOL_CATEGORY_ORDER = [
  "Converters",
  "Validate",
  "Research",
  "Statistics",
  "Write",
  "Reference",
] as const;

function converter(
  definition: Omit<ToolDefinition, "category" | "destination"> & {
    converter: ConverterToolId;
  },
): ToolDefinition {
  const { converter: converterId, ...tool } = definition;
  return {
    ...tool,
    category: "Converters",
    destination: { kind: "converter", converter: converterId },
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
    category: "Converters",
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
    category: "Converters",
    destination: { kind: "typst-project", mode: "visual" },
    slash: ["visual-typst-editor", "typst-visual"],
    tone: "sky",
  },
  converter({
    id: "arxiv-to-latex",
    converter: "arxiv-to-latex",
    name: "arXiv to LaTeX",
    description: "Download an arXiv source bundle, or open a saved archive from disk.",
    icon: Archive,
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
    category: "Converters",
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
    category: "Converters",
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
    category: "Converters",
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
    category: "Validate",
    destination: { kind: "page", page: "bibtex" },
    slash: ["bibtex-validator", "bibtex"],
    tone: "emerald",
  },
  {
    id: "literature-search",
    name: "Citation Search",
    description: "Search several scholarly indexes, scan a document, and save useful citations.",
    icon: LibraryBig,
    tags: ["Scholar indexes", "Document scan", "Saved citations"],
    category: "Research",
    destination: { kind: "page", page: "literature-search" },
    slash: ["citations-search", "citation-search", "literature-search"],
    tone: "blue",
  },
  {
    id: "lab-search",
    name: "Lab Search",
    description: "Find research institutions worldwide through the OpenAlex directory.",
    icon: School,
    tags: ["Institution records", "Country filter", "ROR links"],
    category: "Research",
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
    category: "Research",
    destination: { kind: "page", page: "deadlines" },
    slash: ["conference-deadlines", "deadlines"],
    tone: "amber",
  },
  {
    id: "stats",
    name: "Statistics Calculators",
    description: "Calculate p-values, sample sizes, and confidence intervals locally.",
    icon: Calculator,
    tags: ["p-value", "Sample size", "Confidence interval"],
    category: "Statistics",
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
    category: "Write",
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
    category: "Reference",
    destination: { kind: "page", page: "symbols" },
    slash: ["symbols", "cheatsheet", "greek-letters"],
    tone: "cyan",
  },
];

export function toolById(id: ToolId): ToolDefinition {
  const tool = TOOL_DEFINITIONS.find((candidate) => candidate.id === id);
  if (!tool) throw new Error(`Unknown tool: ${id}`);
  return tool;
}
