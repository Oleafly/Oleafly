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
  icon: ComponentType<{ className?: string }>;
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
    icon: ImageIcon,
    slash: ["image-to-latex"],
    tone: "blue",
  }),
  {
    id: "pdf-to-latex",
    icon: FileInput,
    category: "converters",
    destination: { kind: "page", page: "pdf-import" },
    slash: ["pdf-to-latex", "pdf-import"],
    tone: "rose",
  },
  {
    id: "visual-typst-editor",
    icon: TextCursorInput,
    category: "converters",
    destination: { kind: "typst-project", mode: "visual" },
    slash: ["visual-typst-editor", "typst-visual"],
    tone: "sky",
  },
  converter({
    id: "arxiv-to-latex",
    converter: "arxiv-to-latex",
    icon: ArxivIcon,
    slash: ["arxiv-to-latex", "arxiv-source"],
    tone: "rose",
  }),
  converter({
    id: "equation-to-latex",
    converter: "equation-to-latex",
    icon: Sigma,
    slash: ["equation-to-latex", "math-to-latex"],
    tone: "violet",
  }),
  converter({
    id: "excel-to-latex",
    converter: "excel-to-latex",
    icon: FileSpreadsheet,
    slash: ["excel-to-latex", "spreadsheet-to-latex"],
    tone: "emerald",
  }),
  converter({
    id: "html-to-latex",
    converter: "html-to-latex",
    icon: FileCode2,
    slash: ["html-to-latex"],
    tone: "amber",
  }),
  converter({
    id: "image-to-typst",
    converter: "image-to-typst",
    icon: ImageIcon,
    slash: ["image-to-typst"],
    tone: "sky",
  }),
  converter({
    id: "latex-to-html",
    converter: "latex-to-html",
    icon: FileCode2,
    slash: ["latex-to-html"],
    tone: "amber",
  }),
  {
    id: "latex-to-image",
    icon: FileOutput,
    category: "converters",
    destination: { kind: "page", page: "equation" },
    slash: ["latex-to-image", "latex-preview"],
    tone: "violet",
  },
  converter({
    id: "latex-to-markdown",
    converter: "latex-to-markdown",
    icon: FileText,
    slash: ["latex-to-markdown"],
    tone: "cyan",
  }),
  converter({
    id: "latex-to-typst",
    converter: "latex-to-typst",
    icon: ArrowLeftRight,
    slash: ["latex-to-typst"],
    tone: "sky",
  }),
  converter({
    id: "latex-to-word",
    converter: "latex-to-word",
    icon: FileType2,
    slash: ["latex-to-word", "latex-to-docx"],
    tone: "blue",
  }),
  converter({
    id: "markdown-to-latex",
    converter: "markdown-to-latex",
    icon: FileText,
    slash: ["markdown-to-latex"],
    tone: "cyan",
  }),
  converter({
    id: "markdown-to-typst",
    converter: "markdown-to-typst",
    icon: FileText,
    slash: ["markdown-to-typst"],
    tone: "sky",
  }),
  converter({
    id: "mermaid-to-latex",
    converter: "mermaid-to-latex",
    icon: Network,
    slash: ["mermaid-to-latex", "mermaid-to-tikz"],
    tone: "violet",
  }),
  converter({
    id: "pdf-to-markdown",
    converter: "pdf-to-markdown",
    icon: FileInput,
    slash: ["pdf-to-markdown"],
    tone: "rose",
  }),
  converter({
    id: "pdf-to-typst",
    converter: "pdf-to-typst",
    icon: FileInput,
    slash: ["pdf-to-typst"],
    tone: "rose",
  }),
  {
    id: "table-to-latex",
    icon: Table2,
    category: "converters",
    destination: { kind: "page", page: "table" },
    slash: ["table-to-latex", "latex-table", "table-generator"],
    tone: "cyan",
  },
  {
    id: "typst-editor",
    icon: Braces,
    category: "converters",
    destination: { kind: "typst-project", mode: "source" },
    slash: ["typst-editor", "new-typst"],
    tone: "sky",
  },
  converter({
    id: "typst-to-latex",
    converter: "typst-to-latex",
    icon: ArrowLeftRight,
    slash: ["typst-to-latex"],
    tone: "sky",
  }),
  converter({
    id: "word-to-latex",
    converter: "word-to-latex",
    icon: FileType2,
    slash: ["word-to-latex", "docx-to-latex"],
    tone: "blue",
  }),
  {
    id: "bibtex",
    icon: ShieldCheck,
    category: "validate",
    destination: { kind: "page", page: "bibtex" },
    slash: ["bibtex-validator", "bibtex"],
    tone: "emerald",
  },
  {
    id: "literature-search",
    icon: Sparkles,
    category: "references",
    destination: { kind: "page", page: "literature-search" },
    slash: ["find-citations", "citations-search", "citation-search", "literature-search"],
    tone: "amber",
  },
  {
    id: "lab-search",
    icon: School,
    category: "research",
    destination: { kind: "page", page: "lab-search" },
    slash: ["lab-search", "institution-search"],
    tone: "sky",
  },
  {
    id: "deadlines",
    icon: ClipboardClock,
    category: "research",
    destination: { kind: "page", page: "deadlines" },
    slash: ["conference-deadlines", "deadlines"],
    tone: "amber",
  },
  reference({
    id: "arxiv-citation-generator",
    tool: "arxiv-citation-generator",
    icon: ArxivIcon,
    slash: ["arxiv-citation", "cite-arxiv"],
    tone: "amber",
  }),
  reference({
    id: "bibliography-generator",
    tool: "bibliography-generator",
    icon: Bookmark,
    slash: ["bibliography-generator", "make-bibliography"],
    tone: "amber",
  }),
  reference({
    id: "citation-generator",
    tool: "citation-generator",
    icon: BookOpen,
    slash: ["citation-generator", "make-citation"],
    tone: "amber",
  }),
  reference({
    id: "citation-styles",
    tool: "citation-styles",
    icon: BookOpenText,
    slash: ["citation-styles", "citation-style-generator"],
    tone: "amber",
  }),
  reference({
    id: "doi-to-bibtex",
    tool: "doi-to-bibtex",
    icon: Link2,
    slash: ["doi-to-bibtex", "doi-citation"],
    tone: "amber",
  }),
  reference({
    id: "isbn-to-bibtex",
    tool: "isbn-to-bibtex",
    icon: Hash,
    slash: ["isbn-to-bibtex", "isbn-citation"],
    tone: "amber",
  }),
  reference({
    id: "pubmed-to-bibtex",
    tool: "pubmed-to-bibtex",
    icon: Hash,
    slash: ["pubmed-to-bibtex", "pmid-to-bibtex"],
    tone: "amber",
  }),
  reference({
    id: "url-to-bibtex",
    tool: "url-to-bibtex",
    icon: Link2,
    slash: ["url-to-bibtex", "webpage-citation"],
    tone: "amber",
  }),
  {
    id: "stats",
    icon: Calculator,
    category: "statistics",
    destination: { kind: "page", page: "stats" },
    slash: ["stats", "statistics", "p-value"],
    tone: "blue",
  },
  {
    id: "generators",
    icon: ListChecks,
    category: "write",
    destination: { kind: "page", page: "generators" },
    slash: ["generators", "abstract", "paraphrase"],
    tone: "violet",
  },
  {
    id: "symbols",
    icon: BookOpenText,
    category: "references",
    destination: { kind: "page", page: "symbols" },
    slash: ["symbols", "cheatsheet", "greek-letters"],
    tone: "cyan",
  },
];

interface ToolCopy {
  name: string;
  description: string;
  tags: string[];
}

const TOOL_COPY: Record<ToolId, () => ToolCopy> = {
  "image-to-latex": () => ({
    name: i18n.t(($) => $.researchTools.tools.imageToLatex.name),
    description: i18n.t(($) => $.researchTools.tools.imageToLatex.description),
    tags: [
      i18n.t(($) => $.researchTools.tools.imageToLatex.tag1),
      i18n.t(($) => $.researchTools.tools.imageToLatex.tag2),
      i18n.t(($) => $.researchTools.tools.imageToLatex.tag3),
    ],
  }),
  "pdf-to-latex": () => ({
    name: i18n.t(($) => $.researchTools.tools.pdfToLatex.name),
    description: i18n.t(($) => $.researchTools.tools.pdfToLatex.description),
    tags: [
      i18n.t(($) => $.researchTools.tools.pdfToLatex.tagMath),
      i18n.t(($) => $.researchTools.tools.pdfToLatex.tagFigures),
      i18n.t(($) => $.researchTools.tools.pdfToLatex.tagClientSide),
    ],
  }),
  "visual-typst-editor": () => ({
    name: i18n.t(($) => $.researchTools.tools.visualTypstEditor.name),
    description: i18n.t(($) => $.researchTools.tools.visualTypstEditor.description),
    tags: [
      i18n.t(($) => $.researchTools.tools.visualTypstEditor.tag1),
      i18n.t(($) => $.researchTools.tools.visualTypstEditor.tag2),
      i18n.t(($) => $.researchTools.tools.visualTypstEditor.tag3),
    ],
  }),
  "arxiv-to-latex": () => ({
    name: i18n.t(($) => $.researchTools.tools.arxivToLatex.name),
    description: i18n.t(($) => $.researchTools.tools.arxivToLatex.description),
    tags: [
      i18n.t(($) => $.researchTools.tools.arxivToLatex.tag1),
      i18n.t(($) => $.researchTools.tools.arxivToLatex.tag2),
      i18n.t(($) => $.researchTools.tools.arxivToLatex.tag3),
    ],
  }),
  "equation-to-latex": () => ({
    name: i18n.t(($) => $.researchTools.tools.equationToLatex.name),
    description: i18n.t(($) => $.researchTools.tools.equationToLatex.description),
    tags: [
      i18n.t(($) => $.researchTools.tools.equationToLatex.tag1),
      i18n.t(($) => $.researchTools.tools.equationToLatex.tag2),
      i18n.t(($) => $.researchTools.tools.equationToLatex.tag3),
    ],
  }),
  "excel-to-latex": () => ({
    name: i18n.t(($) => $.researchTools.tools.excelToLatex.name),
    description: i18n.t(($) => $.researchTools.tools.excelToLatex.description),
    tags: [
      i18n.t(($) => $.researchTools.tools.excelToLatex.tag1),
      i18n.t(($) => $.researchTools.tools.excelToLatex.tag2),
      i18n.t(($) => $.researchTools.tools.excelToLatex.tag3),
    ],
  }),
  "html-to-latex": () => ({
    name: i18n.t(($) => $.researchTools.tools.htmlToLatex.name),
    description: i18n.t(($) => $.researchTools.tools.htmlToLatex.description),
    tags: [
      i18n.t(($) => $.researchTools.tools.htmlToLatex.tag1),
      i18n.t(($) => $.researchTools.tools.htmlToLatex.tag2),
      i18n.t(($) => $.researchTools.tools.htmlToLatex.tag3),
    ],
  }),
  "image-to-typst": () => ({
    name: i18n.t(($) => $.researchTools.tools.imageToTypst.name),
    description: i18n.t(($) => $.researchTools.tools.imageToTypst.description),
    tags: [
      i18n.t(($) => $.researchTools.tools.imageToTypst.tag1),
      i18n.t(($) => $.researchTools.tools.imageToTypst.tag2),
      i18n.t(($) => $.researchTools.tools.imageToTypst.tag3),
    ],
  }),
  "latex-to-html": () => ({
    name: i18n.t(($) => $.researchTools.tools.latexToHtml.name),
    description: i18n.t(($) => $.researchTools.tools.latexToHtml.description),
    tags: [
      i18n.t(($) => $.researchTools.tools.latexToHtml.tag1),
      i18n.t(($) => $.researchTools.tools.latexToHtml.tag2),
      i18n.t(($) => $.researchTools.tools.latexToHtml.tag3),
    ],
  }),
  "latex-to-image": () => ({
    name: i18n.t(($) => $.researchTools.tools.latexToImage.name),
    description: i18n.t(($) => $.researchTools.tools.latexToImage.description),
    tags: [
      i18n.t(($) => $.researchTools.tools.latexToImage.tag1),
      i18n.t(($) => $.researchTools.tools.latexToImage.tag2),
      i18n.t(($) => $.researchTools.tools.latexToImage.tag3),
    ],
  }),
  "latex-to-markdown": () => ({
    name: i18n.t(($) => $.researchTools.tools.latexToMarkdown.name),
    description: i18n.t(($) => $.researchTools.tools.latexToMarkdown.description),
    tags: [
      i18n.t(($) => $.researchTools.tools.latexToMarkdown.tag1),
      i18n.t(($) => $.researchTools.tools.latexToMarkdown.tag2),
      i18n.t(($) => $.researchTools.tools.latexToMarkdown.tag3),
    ],
  }),
  "latex-to-typst": () => ({
    name: i18n.t(($) => $.researchTools.tools.latexToTypst.name),
    description: i18n.t(($) => $.researchTools.tools.latexToTypst.description),
    tags: [
      i18n.t(($) => $.researchTools.tools.latexToTypst.tag1),
      i18n.t(($) => $.researchTools.tools.latexToTypst.tag2),
      i18n.t(($) => $.researchTools.tools.latexToTypst.tag3),
    ],
  }),
  "latex-to-word": () => ({
    name: i18n.t(($) => $.researchTools.tools.latexToWord.name),
    description: i18n.t(($) => $.researchTools.tools.latexToWord.description),
    tags: [
      i18n.t(($) => $.researchTools.tools.latexToWord.tag1),
      i18n.t(($) => $.researchTools.tools.latexToWord.tag2),
      i18n.t(($) => $.researchTools.tools.latexToWord.tag3),
    ],
  }),
  "markdown-to-latex": () => ({
    name: i18n.t(($) => $.researchTools.tools.markdownToLatex.name),
    description: i18n.t(($) => $.researchTools.tools.markdownToLatex.description),
    tags: [
      i18n.t(($) => $.researchTools.tools.markdownToLatex.tag1),
      i18n.t(($) => $.researchTools.tools.markdownToLatex.tag2),
      i18n.t(($) => $.researchTools.tools.markdownToLatex.tag3),
    ],
  }),
  "markdown-to-typst": () => ({
    name: i18n.t(($) => $.researchTools.tools.markdownToTypst.name),
    description: i18n.t(($) => $.researchTools.tools.markdownToTypst.description),
    tags: [
      i18n.t(($) => $.researchTools.tools.markdownToTypst.tag1),
      i18n.t(($) => $.researchTools.tools.markdownToTypst.tag2),
      i18n.t(($) => $.researchTools.tools.markdownToTypst.tag3),
    ],
  }),
  "mermaid-to-latex": () => ({
    name: i18n.t(($) => $.researchTools.tools.mermaidToLatex.name),
    description: i18n.t(($) => $.researchTools.tools.mermaidToLatex.description),
    tags: [
      i18n.t(($) => $.researchTools.tools.mermaidToLatex.tag1),
      i18n.t(($) => $.researchTools.tools.mermaidToLatex.tag2),
      i18n.t(($) => $.researchTools.tools.mermaidToLatex.tag3),
    ],
  }),
  "pdf-to-markdown": () => ({
    name: i18n.t(($) => $.researchTools.tools.pdfToMarkdown.name),
    description: i18n.t(($) => $.researchTools.tools.pdfToMarkdown.description),
    tags: [
      i18n.t(($) => $.researchTools.tools.pdfToMarkdown.tag1),
      i18n.t(($) => $.researchTools.tools.pdfToMarkdown.tag2),
      i18n.t(($) => $.researchTools.tools.pdfToMarkdown.tag3),
    ],
  }),
  "pdf-to-typst": () => ({
    name: i18n.t(($) => $.researchTools.tools.pdfToTypst.name),
    description: i18n.t(($) => $.researchTools.tools.pdfToTypst.description),
    tags: [
      i18n.t(($) => $.researchTools.tools.pdfToTypst.tag1),
      i18n.t(($) => $.researchTools.tools.pdfToTypst.tag2),
      i18n.t(($) => $.researchTools.tools.pdfToTypst.tag3),
    ],
  }),
  "table-to-latex": () => ({
    name: i18n.t(($) => $.researchTools.tools.tableToLatex.name),
    description: i18n.t(($) => $.researchTools.tools.tableToLatex.description),
    tags: [
      i18n.t(($) => $.researchTools.tools.tableToLatex.tag1),
      i18n.t(($) => $.researchTools.tools.tableToLatex.tag2),
      i18n.t(($) => $.researchTools.tools.tableToLatex.tag3),
    ],
  }),
  "typst-editor": () => ({
    name: i18n.t(($) => $.researchTools.tools.typstEditor.name),
    description: i18n.t(($) => $.researchTools.tools.typstEditor.description),
    tags: [
      i18n.t(($) => $.researchTools.tools.typstEditor.tag1),
      i18n.t(($) => $.researchTools.tools.typstEditor.tag2),
      i18n.t(($) => $.researchTools.tools.typstEditor.tag3),
    ],
  }),
  "typst-to-latex": () => ({
    name: i18n.t(($) => $.researchTools.tools.typstToLatex.name),
    description: i18n.t(($) => $.researchTools.tools.typstToLatex.description),
    tags: [
      i18n.t(($) => $.researchTools.tools.typstToLatex.tag1),
      i18n.t(($) => $.researchTools.tools.typstToLatex.tag2),
      i18n.t(($) => $.researchTools.tools.typstToLatex.tag3),
    ],
  }),
  "word-to-latex": () => ({
    name: i18n.t(($) => $.researchTools.tools.wordToLatex.name),
    description: i18n.t(($) => $.researchTools.tools.wordToLatex.description),
    tags: [
      i18n.t(($) => $.researchTools.tools.wordToLatex.tag1),
      i18n.t(($) => $.researchTools.tools.wordToLatex.tag2),
      i18n.t(($) => $.researchTools.tools.wordToLatex.tag3),
    ],
  }),
  "bibtex": () => ({
    name: i18n.t(($) => $.researchTools.tools.bibtex.name),
    description: i18n.t(($) => $.researchTools.tools.bibtex.description),
    tags: [
      i18n.t(($) => $.researchTools.tools.bibtex.tagEntryTypes),
      i18n.t(($) => $.researchTools.tools.bibtex.tagRequiredFields),
      i18n.t(($) => $.researchTools.tools.bibtex.tagDuplicateKeys),
    ],
  }),
  "literature-search": () => ({
    name: i18n.t(($) => $.researchTools.tools.literatureSearch.name),
    description: i18n.t(($) => $.researchTools.tools.literatureSearch.description),
    tags: [
      i18n.t(($) => $.researchTools.tools.literatureSearch.tagIndexes),
      i18n.t(($) => $.researchTools.tools.literatureSearch.tagFromDocument),
      i18n.t(($) => $.researchTools.tools.literatureSearch.tagReview),
      i18n.t(($) => $.researchTools.tools.literatureSearch.tagSaved),
    ],
  }),
  "lab-search": () => ({
    name: i18n.t(($) => $.researchTools.tools.labSearch.name),
    description: i18n.t(($) => $.researchTools.tools.labSearch.description),
    tags: [
      i18n.t(($) => $.researchTools.tools.labSearch.tagRecords),
      i18n.t(($) => $.researchTools.tools.labSearch.tagCountryFilter),
      i18n.t(($) => $.researchTools.tools.labSearch.tagRor),
    ],
  }),
  "deadlines": () => ({
    name: i18n.t(($) => $.researchTools.tools.deadlines.name),
    description: i18n.t(($) => $.researchTools.tools.deadlines.description),
    tags: [
      i18n.t(($) => $.researchTools.tools.deadlines.tagCountdown),
      i18n.t(($) => $.researchTools.tools.deadlines.tagFieldFilters),
      i18n.t(($) => $.researchTools.tools.deadlines.tagSource),
    ],
  }),
  "arxiv-citation-generator": () => ({
    name: i18n.t(($) => $.researchTools.tools.arxivCitationGenerator.name),
    description: i18n.t(($) => $.researchTools.tools.arxivCitationGenerator.description),
    tags: [
      i18n.t(($) => $.researchTools.tools.arxivCitationGenerator.tag1),
      i18n.t(($) => $.researchTools.tools.arxivCitationGenerator.tag2),
      i18n.t(($) => $.researchTools.tools.arxivCitationGenerator.tag3),
    ],
  }),
  "bibliography-generator": () => ({
    name: i18n.t(($) => $.researchTools.tools.bibliographyGenerator.name),
    description: i18n.t(($) => $.researchTools.tools.bibliographyGenerator.description),
    tags: [
      i18n.t(($) => $.researchTools.tools.bibliographyGenerator.tag1),
      i18n.t(($) => $.researchTools.tools.bibliographyGenerator.tag2),
      i18n.t(($) => $.researchTools.tools.bibliographyGenerator.tag3),
    ],
  }),
  "citation-generator": () => ({
    name: i18n.t(($) => $.researchTools.tools.citationGenerator.name),
    description: i18n.t(($) => $.researchTools.tools.citationGenerator.description),
    tags: [
      i18n.t(($) => $.researchTools.tools.citationGenerator.tag1),
      i18n.t(($) => $.researchTools.tools.citationGenerator.tag2),
      i18n.t(($) => $.researchTools.tools.citationGenerator.tag3),
    ],
  }),
  "citation-styles": () => ({
    name: i18n.t(($) => $.researchTools.tools.citationStyles.name),
    description: i18n.t(($) => $.researchTools.tools.citationStyles.description),
    tags: [
      i18n.t(($) => $.researchTools.tools.citationStyles.tag1),
      i18n.t(($) => $.researchTools.tools.citationStyles.tag2),
      i18n.t(($) => $.researchTools.tools.citationStyles.tag3),
    ],
  }),
  "doi-to-bibtex": () => ({
    name: i18n.t(($) => $.researchTools.tools.doiToBibtex.name),
    description: i18n.t(($) => $.researchTools.tools.doiToBibtex.description),
    tags: [
      i18n.t(($) => $.researchTools.tools.doiToBibtex.tag1),
      i18n.t(($) => $.researchTools.tools.doiToBibtex.tag2),
      i18n.t(($) => $.researchTools.tools.doiToBibtex.tag3),
    ],
  }),
  "isbn-to-bibtex": () => ({
    name: i18n.t(($) => $.researchTools.tools.isbnToBibtex.name),
    description: i18n.t(($) => $.researchTools.tools.isbnToBibtex.description),
    tags: [
      i18n.t(($) => $.researchTools.tools.isbnToBibtex.tag1),
      i18n.t(($) => $.researchTools.tools.isbnToBibtex.tag2),
      i18n.t(($) => $.researchTools.tools.isbnToBibtex.tag3),
    ],
  }),
  "pubmed-to-bibtex": () => ({
    name: i18n.t(($) => $.researchTools.tools.pubmedToBibtex.name),
    description: i18n.t(($) => $.researchTools.tools.pubmedToBibtex.description),
    tags: [
      i18n.t(($) => $.researchTools.tools.pubmedToBibtex.tag1),
      i18n.t(($) => $.researchTools.tools.pubmedToBibtex.tag2),
      i18n.t(($) => $.researchTools.tools.pubmedToBibtex.tag3),
    ],
  }),
  "url-to-bibtex": () => ({
    name: i18n.t(($) => $.researchTools.tools.urlToBibtex.name),
    description: i18n.t(($) => $.researchTools.tools.urlToBibtex.description),
    tags: [
      i18n.t(($) => $.researchTools.tools.urlToBibtex.tag1),
      i18n.t(($) => $.researchTools.tools.urlToBibtex.tag2),
      i18n.t(($) => $.researchTools.tools.urlToBibtex.tag3),
    ],
  }),
  "stats": () => ({
    name: i18n.t(($) => $.researchTools.tools.stats.name),
    description: i18n.t(($) => $.researchTools.tools.stats.description),
    tags: [
      i18n.t(($) => $.researchTools.tools.stats.tag1),
      i18n.t(($) => $.researchTools.tools.stats.tag2),
      i18n.t(($) => $.researchTools.tools.stats.tag3),
    ],
  }),
  "generators": () => ({
    name: i18n.t(($) => $.researchTools.tools.generators.name),
    description: i18n.t(($) => $.researchTools.tools.generators.description),
    tags: [
      i18n.t(($) => $.researchTools.tools.generators.tag1),
      i18n.t(($) => $.researchTools.tools.generators.tag2),
      i18n.t(($) => $.researchTools.tools.generators.tag3),
      i18n.t(($) => $.researchTools.tools.generators.tag4),
    ],
  }),
  "symbols": () => ({
    name: i18n.t(($) => $.researchTools.tools.symbols.name),
    description: i18n.t(($) => $.researchTools.tools.symbols.description),
    tags: [
      i18n.t(($) => $.researchTools.tools.symbols.tag1),
      i18n.t(($) => $.researchTools.tools.symbols.tag2),
      i18n.t(($) => $.researchTools.tools.symbols.tag3),
      i18n.t(($) => $.researchTools.tools.symbols.tag4),
    ],
  }),
  "equation": () => ({
    name: i18n.t(($) => $.researchTools.tools.equation.name),
    description: i18n.t(($) => $.researchTools.tools.equation.description),
    tags: [
      i18n.t(($) => $.researchTools.tools.equation.tagKatex),
      i18n.t(($) => $.researchTools.tools.equation.tagModes),
      i18n.t(($) => $.researchTools.tools.equation.tagCopy),
    ],
  }),
  "table": () => ({
    name: i18n.t(($) => $.researchTools.tools.table.name),
    description: i18n.t(($) => $.researchTools.tools.table.description),
    tags: [
      i18n.t(($) => $.researchTools.tools.table.tagVisualEditor),
      i18n.t(($) => $.researchTools.tools.table.tagBooktabs),
      i18n.t(($) => $.researchTools.tools.table.tagExport),
    ],
  }),
};

export function toolName(id: ToolId): string {
  return TOOL_COPY[id]().name;
}

export function toolDescription(id: ToolId): string {
  return TOOL_COPY[id]().description;
}

export function toolTags(id: ToolId): string[] {
  return TOOL_COPY[id]().tags;
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
