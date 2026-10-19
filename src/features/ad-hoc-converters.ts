import { convertPages } from "@oleafly/pdf-to-latex";
import type { AdHocArtifact, AdHocCheck } from "@/lib/tauri";
import { extractArxivSource, type AdHocConversionRequest } from "@/lib/tauri";
import { emitTable, readTableRowsFromBytes } from "@/features/table-import";
import { mermaidToFletcher, mermaidToTikz } from "@/features/mermaid-to-tikz";
import { CONVERTED_MAIN_FILE, flattenLatexInputs, typstSupportFiles } from "@/features/arxiv-typst";
import type { ConverterToolId } from "@/lib/converter-types";
import { i18n } from "@/i18n";
import { bytesToBase64 } from "@/lib/base64";
import { readImageInput } from "@/features/tools-ai/image-input";
import { latexMathToTypst, pandocConvert } from "@/features/tools-ai/pandoc-text";
import { LONG_SCAN_PAGES, ScanConfirmationNeeded, selectedPages } from "@/features/tools-ai/scan-estimate";
import { resolveToolsModel } from "@/features/tools-ai/tools-model";
import {
  transcribeEquationText,
  transcribeImage,
  transcribePdfPages,
} from "@/features/tools-ai/transcribe";

export { LocalModelError, ToolsModelError } from "@/features/tools-ai/tools-model";
export { ScanConfirmationNeeded, transcribePdfPages };

export type ConverterInputKind = "text" | "file" | "image-or-text" | "arxiv";
export type ProjectTarget = "latex" | "markdown" | "typst";

export type ConverterProgressStep =
  | "readingPages"
  | "documentStructure"
  | "mermaid"
  | "firstSheet"
  | "visionModel"
  | "readingEquation"
  | "convertingEquation"
  | "unpackingSource"
  | "downloadingSource"
  | "convertingSource"
  | "transcribingPage"
  | "uploadingPdf"
  | "formattingTranscription";

export interface ConverterProgress {
  step: ConverterProgressStep;
  page?: number;
  total?: number;
  /** The Tools model doing the work, by name. */
  model?: string;
}

export type ConverterProgressReporter = (progress: ConverterProgress) => void;

export interface AdHocConverterDefinition {
  id: ConverterToolId;
  inputKind: ConverterInputKind;
  accept?: string;
  example?: string;
  sourceFileName?: string;
  outputFileName: string;
  outputMediaType: string;
  projectTarget?: ProjectTarget;
  /** Runs on the Tools model: always, or only for scanned PDFs. */
  usesModel?: "always" | "scans";
}

export interface AdHocConverterCopy {
  title: string;
  subtitle: string;
  inputLabel: string;
  inputHint: string;
  outputLabel: string;
}

const LATEX_EXAMPLE = String.raw`\documentclass{article}
\usepackage{amsmath}
\begin{document}
\section{A compact example}
Euler's identity is
\[
  e^{i\pi} + 1 = 0.
\]
\end{document}`;

const MARKDOWN_EXAMPLE = `# A compact example

Euler's identity is $e^{i\\pi} + 1 = 0$.

- Portable source
- Local conversion`;

const HTML_EXAMPLE = `<article>
  <h1>A compact example</h1>
  <p>Euler's identity is <em>e</em><sup>iπ</sup> + 1 = 0.</p>
  <ul><li>Semantic HTML</li><li>Local conversion</li></ul>
</article>`;

const MERMAID_EXAMPLE = `flowchart TD
  idea([Research question]) --> search[Search literature]
  search --> decide{Enough evidence?}
  decide -->|Yes| write[Write synthesis]
  decide -.->|No| search`;

const CSV_EXAMPLE = `Method,Accuracy,Runtime (s)
Baseline,0.82,14.2
Oleafly,0.95,9.8`;

const SPREADSHEET_ACCEPT = ".xlsx,.xls,.csv,.tsv,text/csv,text/tab-separated-values";
const IMAGE_ACCEPT = "image/png,image/jpeg,image/webp";
const ARXIV_ACCEPT = ".gz,.tgz,.tar.gz,application/gzip";
const WORD_ACCEPT = ".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const WORD_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const TYPST_EXAMPLE = `= A compact example

Euler's identity is $e^(i pi) + 1 = 0$.

- Portable source
- Local conversion`;

export const AD_HOC_CONVERTERS: Record<ConverterToolId, AdHocConverterDefinition> = {
  "image-to-latex": {
    id: "image-to-latex",
    usesModel: "always",
    inputKind: "file",
    accept: "image/png,image/jpeg,image/webp",
    outputFileName: "transcription.tex",
    outputMediaType: "application/x-tex",
    projectTarget: "latex",
  },
  "arxiv-to-latex": {
    id: "arxiv-to-latex",
    inputKind: "arxiv",
    accept: ARXIV_ACCEPT,
    example: "1706.03762",
    outputFileName: "arxiv-source.zip",
    outputMediaType: "application/zip",
    projectTarget: "latex",
  },
  "equation-to-latex": {
    id: "equation-to-latex",
    usesModel: "always",
    inputKind: "image-or-text",
    accept: "image/png,image/jpeg,image/webp",
    example: "e^(iπ) + 1 = 0",
    outputFileName: "equation.tex",
    outputMediaType: "application/x-tex",
  },
  "excel-to-latex": {
    id: "excel-to-latex",
    inputKind: "file",
    accept: SPREADSHEET_ACCEPT,
    outputFileName: "table.tex",
    outputMediaType: "application/x-tex",
  },
  "html-to-latex": {
    id: "html-to-latex",
    inputKind: "text",
    sourceFileName: "source.html",
    example: HTML_EXAMPLE,
    outputFileName: "converted.tex",
    outputMediaType: "application/x-tex",
    projectTarget: "latex",
  },
  "image-to-typst": {
    id: "image-to-typst",
    usesModel: "always",
    inputKind: "file",
    accept: "image/png,image/jpeg,image/webp",
    outputFileName: "transcription.typ",
    outputMediaType: "text/x-typst",
    projectTarget: "typst",
  },
  "latex-to-html": {
    id: "latex-to-html",
    inputKind: "text",
    sourceFileName: "source.tex",
    example: LATEX_EXAMPLE,
    outputFileName: "converted.html",
    outputMediaType: "text/html",
  },
  "latex-to-markdown": {
    id: "latex-to-markdown",
    inputKind: "text",
    sourceFileName: "source.tex",
    example: LATEX_EXAMPLE,
    outputFileName: "converted.md",
    outputMediaType: "text/markdown",
    projectTarget: "markdown",
  },
  "latex-to-typst": {
    id: "latex-to-typst",
    inputKind: "text",
    sourceFileName: "source.tex",
    example: LATEX_EXAMPLE,
    outputFileName: "converted.typ",
    outputMediaType: "text/x-typst",
    projectTarget: "typst",
  },
  "latex-to-word": {
    id: "latex-to-word",
    inputKind: "text",
    sourceFileName: "source.tex",
    example: LATEX_EXAMPLE,
    outputFileName: "converted.docx",
    outputMediaType: WORD_MEDIA_TYPE,
  },
  "markdown-to-latex": {
    id: "markdown-to-latex",
    inputKind: "text",
    sourceFileName: "source.md",
    example: MARKDOWN_EXAMPLE,
    outputFileName: "converted.tex",
    outputMediaType: "application/x-tex",
    projectTarget: "latex",
  },
  "markdown-to-typst": {
    id: "markdown-to-typst",
    inputKind: "text",
    sourceFileName: "source.md",
    example: MARKDOWN_EXAMPLE,
    outputFileName: "converted.typ",
    outputMediaType: "text/x-typst",
    projectTarget: "typst",
  },
  "mermaid-to-latex": {
    id: "mermaid-to-latex",
    inputKind: "text",
    sourceFileName: "diagram.mmd",
    example: MERMAID_EXAMPLE,
    outputFileName: "diagram.tex",
    outputMediaType: "application/x-tex",
  },
  "pdf-to-markdown": {
    id: "pdf-to-markdown",
    usesModel: "scans",
    inputKind: "file",
    accept: ".pdf,application/pdf",
    outputFileName: "converted.md",
    outputMediaType: "text/markdown",
    projectTarget: "markdown",
  },
  "pdf-to-typst": {
    id: "pdf-to-typst",
    usesModel: "scans",
    inputKind: "file",
    accept: ".pdf,application/pdf",
    outputFileName: "converted.typ",
    outputMediaType: "text/x-typst",
    projectTarget: "typst",
  },
  "typst-to-latex": {
    id: "typst-to-latex",
    inputKind: "text",
    sourceFileName: "source.typ",
    example: TYPST_EXAMPLE,
    outputFileName: "converted.tex",
    outputMediaType: "application/x-tex",
    projectTarget: "latex",
  },
  "word-to-latex": {
    id: "word-to-latex",
    inputKind: "file",
    accept: WORD_ACCEPT,
    outputFileName: "converted.tex",
    outputMediaType: "application/x-tex",
    projectTarget: "latex",
  },
  "arxiv-to-typst": {
    id: "arxiv-to-typst",
    inputKind: "arxiv",
    accept: ARXIV_ACCEPT,
    example: "1706.03762",
    outputFileName: CONVERTED_MAIN_FILE,
    outputMediaType: "text/x-typst",
    projectTarget: "typst",
  },
  "csv-to-typst": {
    id: "csv-to-typst",
    inputKind: "text",
    sourceFileName: "table.csv",
    example: CSV_EXAMPLE,
    outputFileName: "table.typ",
    outputMediaType: "text/x-typst",
  },
  "equation-to-typst": {
    id: "equation-to-typst",
    usesModel: "always",
    inputKind: "image-or-text",
    accept: IMAGE_ACCEPT,
    sourceFileName: "equation.tex",
    example: "e^(iπ) + 1 = 0",
    outputFileName: "equation.typ",
    outputMediaType: "text/x-typst",
  },
  "excel-to-typst": {
    id: "excel-to-typst",
    inputKind: "file",
    accept: SPREADSHEET_ACCEPT,
    outputFileName: "table.typ",
    outputMediaType: "text/x-typst",
  },
  "html-to-typst": {
    id: "html-to-typst",
    inputKind: "text",
    sourceFileName: "source.html",
    example: HTML_EXAMPLE,
    outputFileName: "converted.typ",
    outputMediaType: "text/x-typst",
    projectTarget: "typst",
  },
  "mermaid-to-typst": {
    id: "mermaid-to-typst",
    inputKind: "text",
    sourceFileName: "diagram.mmd",
    example: MERMAID_EXAMPLE,
    outputFileName: "diagram.typ",
    outputMediaType: "text/x-typst",
  },
  "typst-to-html": {
    id: "typst-to-html",
    inputKind: "text",
    sourceFileName: "source.typ",
    example: TYPST_EXAMPLE,
    outputFileName: "converted.html",
    outputMediaType: "text/html",
  },
  "typst-to-markdown": {
    id: "typst-to-markdown",
    inputKind: "text",
    sourceFileName: "source.typ",
    example: TYPST_EXAMPLE,
    outputFileName: "converted.md",
    outputMediaType: "text/markdown",
    projectTarget: "markdown",
  },
  "typst-to-word": {
    id: "typst-to-word",
    inputKind: "text",
    sourceFileName: "source.typ",
    example: TYPST_EXAMPLE,
    outputFileName: "converted.docx",
    outputMediaType: WORD_MEDIA_TYPE,
  },
  "word-to-typst": {
    id: "word-to-typst",
    inputKind: "file",
    accept: WORD_ACCEPT,
    outputFileName: "converted.typ",
    outputMediaType: "text/x-typst",
    projectTarget: "typst",
  },
};

const CONVERTER_COPY: Record<ConverterToolId, () => AdHocConverterCopy> = {
  "image-to-latex": () => ({
    title: i18n.t(($) => $.researchTools.converters.imageToLatex.title),
    subtitle: i18n.t(($) => $.researchTools.converters.imageToLatex.subtitle),
    inputLabel: i18n.t(($) => $.researchTools.converters.imageToLatex.inputLabel),
    inputHint: i18n.t(($) => $.researchTools.converters.imageToLatex.inputHint),
    outputLabel: i18n.t(($) => $.researchTools.converters.imageToLatex.outputLabel),
  }),
  "arxiv-to-latex": () => ({
    title: i18n.t(($) => $.researchTools.converters.arxivToLatex.title),
    subtitle: i18n.t(($) => $.researchTools.converters.arxivToLatex.subtitle),
    inputLabel: i18n.t(($) => $.researchTools.converters.arxivToLatex.inputLabel),
    inputHint: i18n.t(($) => $.researchTools.converters.arxivToLatex.inputHint),
    outputLabel: i18n.t(($) => $.researchTools.converters.arxivToLatex.outputLabel),
  }),
  "equation-to-latex": () => ({
    title: i18n.t(($) => $.researchTools.converters.equationToLatex.title),
    subtitle: i18n.t(($) => $.researchTools.converters.equationToLatex.subtitle),
    inputLabel: i18n.t(($) => $.researchTools.converters.equationToLatex.inputLabel),
    inputHint: i18n.t(($) => $.researchTools.converters.equationToLatex.inputHint),
    outputLabel: i18n.t(($) => $.researchTools.converters.equationToLatex.outputLabel),
  }),
  "excel-to-latex": () => ({
    title: i18n.t(($) => $.researchTools.converters.excelToLatex.title),
    subtitle: i18n.t(($) => $.researchTools.converters.excelToLatex.subtitle),
    inputLabel: i18n.t(($) => $.researchTools.converters.excelToLatex.inputLabel),
    inputHint: i18n.t(($) => $.researchTools.converters.excelToLatex.inputHint),
    outputLabel: i18n.t(($) => $.researchTools.converters.excelToLatex.outputLabel),
  }),
  "html-to-latex": () => ({
    title: i18n.t(($) => $.researchTools.converters.htmlToLatex.title),
    subtitle: i18n.t(($) => $.researchTools.converters.htmlToLatex.subtitle),
    inputLabel: i18n.t(($) => $.researchTools.converters.htmlToLatex.inputLabel),
    inputHint: i18n.t(($) => $.researchTools.converters.htmlToLatex.inputHint),
    outputLabel: i18n.t(($) => $.researchTools.converters.htmlToLatex.outputLabel),
  }),
  "image-to-typst": () => ({
    title: i18n.t(($) => $.researchTools.converters.imageToTypst.title),
    subtitle: i18n.t(($) => $.researchTools.converters.imageToTypst.subtitle),
    inputLabel: i18n.t(($) => $.researchTools.converters.imageToTypst.inputLabel),
    inputHint: i18n.t(($) => $.researchTools.converters.imageToTypst.inputHint),
    outputLabel: i18n.t(($) => $.researchTools.converters.imageToTypst.outputLabel),
  }),
  "latex-to-html": () => ({
    title: i18n.t(($) => $.researchTools.converters.latexToHtml.title),
    subtitle: i18n.t(($) => $.researchTools.converters.latexToHtml.subtitle),
    inputLabel: i18n.t(($) => $.researchTools.converters.latexToHtml.inputLabel),
    inputHint: i18n.t(($) => $.researchTools.converters.latexToHtml.inputHint),
    outputLabel: i18n.t(($) => $.researchTools.converters.latexToHtml.outputLabel),
  }),
  "latex-to-markdown": () => ({
    title: i18n.t(($) => $.researchTools.converters.latexToMarkdown.title),
    subtitle: i18n.t(($) => $.researchTools.converters.latexToMarkdown.subtitle),
    inputLabel: i18n.t(($) => $.researchTools.converters.latexToMarkdown.inputLabel),
    inputHint: i18n.t(($) => $.researchTools.converters.latexToMarkdown.inputHint),
    outputLabel: i18n.t(($) => $.researchTools.converters.latexToMarkdown.outputLabel),
  }),
  "latex-to-typst": () => ({
    title: i18n.t(($) => $.researchTools.converters.latexToTypst.title),
    subtitle: i18n.t(($) => $.researchTools.converters.latexToTypst.subtitle),
    inputLabel: i18n.t(($) => $.researchTools.converters.latexToTypst.inputLabel),
    inputHint: i18n.t(($) => $.researchTools.converters.latexToTypst.inputHint),
    outputLabel: i18n.t(($) => $.researchTools.converters.latexToTypst.outputLabel),
  }),
  "latex-to-word": () => ({
    title: i18n.t(($) => $.researchTools.converters.latexToWord.title),
    subtitle: i18n.t(($) => $.researchTools.converters.latexToWord.subtitle),
    inputLabel: i18n.t(($) => $.researchTools.converters.latexToWord.inputLabel),
    inputHint: i18n.t(($) => $.researchTools.converters.latexToWord.inputHint),
    outputLabel: i18n.t(($) => $.researchTools.converters.latexToWord.outputLabel),
  }),
  "markdown-to-latex": () => ({
    title: i18n.t(($) => $.researchTools.converters.markdownToLatex.title),
    subtitle: i18n.t(($) => $.researchTools.converters.markdownToLatex.subtitle),
    inputLabel: i18n.t(($) => $.researchTools.converters.markdownToLatex.inputLabel),
    inputHint: i18n.t(($) => $.researchTools.converters.markdownToLatex.inputHint),
    outputLabel: i18n.t(($) => $.researchTools.converters.markdownToLatex.outputLabel),
  }),
  "markdown-to-typst": () => ({
    title: i18n.t(($) => $.researchTools.converters.markdownToTypst.title),
    subtitle: i18n.t(($) => $.researchTools.converters.markdownToTypst.subtitle),
    inputLabel: i18n.t(($) => $.researchTools.converters.markdownToTypst.inputLabel),
    inputHint: i18n.t(($) => $.researchTools.converters.markdownToTypst.inputHint),
    outputLabel: i18n.t(($) => $.researchTools.converters.markdownToTypst.outputLabel),
  }),
  "mermaid-to-latex": () => ({
    title: i18n.t(($) => $.researchTools.converters.mermaidToLatex.title),
    subtitle: i18n.t(($) => $.researchTools.converters.mermaidToLatex.subtitle),
    inputLabel: i18n.t(($) => $.researchTools.converters.mermaidToLatex.inputLabel),
    inputHint: i18n.t(($) => $.researchTools.converters.mermaidToLatex.inputHint),
    outputLabel: i18n.t(($) => $.researchTools.converters.mermaidToLatex.outputLabel),
  }),
  "pdf-to-markdown": () => ({
    title: i18n.t(($) => $.researchTools.converters.pdfToMarkdown.title),
    subtitle: i18n.t(($) => $.researchTools.converters.pdfToMarkdown.subtitle),
    inputLabel: i18n.t(($) => $.researchTools.converters.pdfToMarkdown.inputLabel),
    inputHint: i18n.t(($) => $.researchTools.converters.pdfToMarkdown.inputHint),
    outputLabel: i18n.t(($) => $.researchTools.converters.pdfToMarkdown.outputLabel),
  }),
  "pdf-to-typst": () => ({
    title: i18n.t(($) => $.researchTools.converters.pdfToTypst.title),
    subtitle: i18n.t(($) => $.researchTools.converters.pdfToTypst.subtitle),
    inputLabel: i18n.t(($) => $.researchTools.converters.pdfToTypst.inputLabel),
    inputHint: i18n.t(($) => $.researchTools.converters.pdfToTypst.inputHint),
    outputLabel: i18n.t(($) => $.researchTools.converters.pdfToTypst.outputLabel),
  }),
  "typst-to-latex": () => ({
    title: i18n.t(($) => $.researchTools.converters.typstToLatex.title),
    subtitle: i18n.t(($) => $.researchTools.converters.typstToLatex.subtitle),
    inputLabel: i18n.t(($) => $.researchTools.converters.typstToLatex.inputLabel),
    inputHint: i18n.t(($) => $.researchTools.converters.typstToLatex.inputHint),
    outputLabel: i18n.t(($) => $.researchTools.converters.typstToLatex.outputLabel),
  }),
  "word-to-latex": () => ({
    title: i18n.t(($) => $.researchTools.converters.wordToLatex.title),
    subtitle: i18n.t(($) => $.researchTools.converters.wordToLatex.subtitle),
    inputLabel: i18n.t(($) => $.researchTools.converters.wordToLatex.inputLabel),
    inputHint: i18n.t(($) => $.researchTools.converters.wordToLatex.inputHint),
    outputLabel: i18n.t(($) => $.researchTools.converters.wordToLatex.outputLabel),
  }),
  "arxiv-to-typst": () => ({
    title: i18n.t(($) => $.researchTools.converters.arxivToTypst.title),
    subtitle: i18n.t(($) => $.researchTools.converters.arxivToTypst.subtitle),
    inputLabel: i18n.t(($) => $.researchTools.converters.arxivToTypst.inputLabel),
    inputHint: i18n.t(($) => $.researchTools.converters.arxivToTypst.inputHint),
    outputLabel: i18n.t(($) => $.researchTools.converters.arxivToTypst.outputLabel),
  }),
  "csv-to-typst": () => ({
    title: i18n.t(($) => $.researchTools.converters.csvToTypst.title),
    subtitle: i18n.t(($) => $.researchTools.converters.csvToTypst.subtitle),
    inputLabel: i18n.t(($) => $.researchTools.converters.csvToTypst.inputLabel),
    inputHint: i18n.t(($) => $.researchTools.converters.csvToTypst.inputHint),
    outputLabel: i18n.t(($) => $.researchTools.converters.csvToTypst.outputLabel),
  }),
  "equation-to-typst": () => ({
    title: i18n.t(($) => $.researchTools.converters.equationToTypst.title),
    subtitle: i18n.t(($) => $.researchTools.converters.equationToTypst.subtitle),
    inputLabel: i18n.t(($) => $.researchTools.converters.equationToTypst.inputLabel),
    inputHint: i18n.t(($) => $.researchTools.converters.equationToTypst.inputHint),
    outputLabel: i18n.t(($) => $.researchTools.converters.equationToTypst.outputLabel),
  }),
  "excel-to-typst": () => ({
    title: i18n.t(($) => $.researchTools.converters.excelToTypst.title),
    subtitle: i18n.t(($) => $.researchTools.converters.excelToTypst.subtitle),
    inputLabel: i18n.t(($) => $.researchTools.converters.excelToTypst.inputLabel),
    inputHint: i18n.t(($) => $.researchTools.converters.excelToTypst.inputHint),
    outputLabel: i18n.t(($) => $.researchTools.converters.excelToTypst.outputLabel),
  }),
  "html-to-typst": () => ({
    title: i18n.t(($) => $.researchTools.converters.htmlToTypst.title),
    subtitle: i18n.t(($) => $.researchTools.converters.htmlToTypst.subtitle),
    inputLabel: i18n.t(($) => $.researchTools.converters.htmlToTypst.inputLabel),
    inputHint: i18n.t(($) => $.researchTools.converters.htmlToTypst.inputHint),
    outputLabel: i18n.t(($) => $.researchTools.converters.htmlToTypst.outputLabel),
  }),
  "mermaid-to-typst": () => ({
    title: i18n.t(($) => $.researchTools.converters.mermaidToTypst.title),
    subtitle: i18n.t(($) => $.researchTools.converters.mermaidToTypst.subtitle),
    inputLabel: i18n.t(($) => $.researchTools.converters.mermaidToTypst.inputLabel),
    inputHint: i18n.t(($) => $.researchTools.converters.mermaidToTypst.inputHint),
    outputLabel: i18n.t(($) => $.researchTools.converters.mermaidToTypst.outputLabel),
  }),
  "typst-to-html": () => ({
    title: i18n.t(($) => $.researchTools.converters.typstToHtml.title),
    subtitle: i18n.t(($) => $.researchTools.converters.typstToHtml.subtitle),
    inputLabel: i18n.t(($) => $.researchTools.converters.typstToHtml.inputLabel),
    inputHint: i18n.t(($) => $.researchTools.converters.typstToHtml.inputHint),
    outputLabel: i18n.t(($) => $.researchTools.converters.typstToHtml.outputLabel),
  }),
  "typst-to-markdown": () => ({
    title: i18n.t(($) => $.researchTools.converters.typstToMarkdown.title),
    subtitle: i18n.t(($) => $.researchTools.converters.typstToMarkdown.subtitle),
    inputLabel: i18n.t(($) => $.researchTools.converters.typstToMarkdown.inputLabel),
    inputHint: i18n.t(($) => $.researchTools.converters.typstToMarkdown.inputHint),
    outputLabel: i18n.t(($) => $.researchTools.converters.typstToMarkdown.outputLabel),
  }),
  "typst-to-word": () => ({
    title: i18n.t(($) => $.researchTools.converters.typstToWord.title),
    subtitle: i18n.t(($) => $.researchTools.converters.typstToWord.subtitle),
    inputLabel: i18n.t(($) => $.researchTools.converters.typstToWord.inputLabel),
    inputHint: i18n.t(($) => $.researchTools.converters.typstToWord.inputHint),
    outputLabel: i18n.t(($) => $.researchTools.converters.typstToWord.outputLabel),
  }),
  "word-to-typst": () => ({
    title: i18n.t(($) => $.researchTools.converters.wordToTypst.title),
    subtitle: i18n.t(($) => $.researchTools.converters.wordToTypst.subtitle),
    inputLabel: i18n.t(($) => $.researchTools.converters.wordToTypst.inputLabel),
    inputHint: i18n.t(($) => $.researchTools.converters.wordToTypst.inputHint),
    outputLabel: i18n.t(($) => $.researchTools.converters.wordToTypst.outputLabel),
  }),
};

export function converterCopy(id: ConverterToolId): AdHocConverterCopy {
  return CONVERTER_COPY[id]();
}

export interface ConverterInput {
  text: string;
  file: File | null;
  typstVersion?: string | null;
  /** The user confirmed a long scanned-PDF run. */
  scanConfirmed?: boolean;
}

export interface ConverterOutput {
  kind: "text" | "binary" | "bundle";
  text: string | null;
  dataBase64: string | null;
  fileName: string;
  mediaType: string;
  files: AdHocArtifact[];
  mainFile?: string;
  note?: string;
  details?: string[];
}

export function projectReadySource(target: ProjectTarget, source: string): string {
  if (target !== "latex" || /\\documentclass\b/.test(source)) return source;
  return [
    "\\documentclass{article}",
    "\\usepackage{amsmath,amssymb,booktabs,graphicx,array}",
    "\\begin{document}",
    source,
    "\\end{document}",
  ].join("\n");
}

function dataUrlBase64(dataUrl: string): string {
  const comma = dataUrl.indexOf(",");
  return comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
}

function normalizeEquation(value: string): string | null {
  const trimmed = value.trim().replace(/^\$+|\$+$/g, "").trim();
  if (!trimmed) return null;
  const naturalLanguage = /\b(?:integral|sum|square root|divided by|from|to the power|equals)\b/i;
  if (naturalLanguage.test(trimmed)) return null;
  return trimmed
    .replace(/sqrt\(([^()]*)\)/gi, "\\sqrt{$1}")
    .replace(/√\(([^()]*)\)/g, "\\sqrt{$1}")
    .replace(/\^\(([^()]*)\)/g, "^{$1}")
    .replace(/_\(([^()]*)\)/g, "_{$1}")
    .replaceAll("π", "\\pi")
    .replaceAll("∞", "\\infty")
    .replaceAll("≤", "\\le")
    .replaceAll("≥", "\\ge")
    .replaceAll("≠", "\\ne")
    .replaceAll("→", "\\to")
    .replaceAll("×", "\\times")
    .replaceAll("÷", "\\div");
}

async function runPandoc(request: AdHocConversionRequest): Promise<ConverterOutput> {
  return { ...(await pandocConvert(request)) };
}

function textOutput(
  definition: AdHocConverterDefinition,
  text: string,
  files: AdHocArtifact[] = [],
  note?: string,
): ConverterOutput {
  return {
    kind: "text",
    text,
    dataBase64: null,
    fileName: definition.outputFileName,
    mediaType: definition.outputMediaType,
    files,
    note,
  };
}

function requireFile(input: ConverterInput): File {
  if (!input.file) throw new Error(i18n.t(($) => $.researchTools.converterErrors.chooseFile));
  if (input.file.size > 128 * 1024 * 1024) {
    throw new Error(i18n.t(($) => $.researchTools.converterErrors.fileTooLarge));
  }
  return input.file;
}

async function pdfToText(
  definition: AdHocConverterDefinition,
  input: ConverterInput,
  target: "markdown" | "typst",
  onProgress?: ConverterProgressReporter,
  signal?: AbortSignal,
): Promise<ConverterOutput> {
  const bytes = new Uint8Array(await requireFile(input).arrayBuffer());
  onProgress?.({ step: "readingPages" });
  const { extractPagesForConvert } = await import("@oleafly/pdf-to-latex/pdf-adapter");
  const extracted = await extractPagesForConvert(bytes);
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  const latex = convertPages(extracted.pages, {});
  if (latex.report.likelyScanned) {
    const pages = selectedPages(latex.report.pages);
    if (pages.length >= LONG_SCAN_PAGES && !input.scanConfirmed) {
      throw new ScanConfirmationNeeded(extracted.pages.map(({ width, height }) => ({ width, height })));
    }
    const transcribed = await transcribePdfPages(
      bytes,
      pages,
      target === "typst" ? "Typst" : "Markdown",
      onProgress,
      signal,
    );
    return textOutput(
      definition,
      transcribed.text,
      [],
      i18n.t(($) => $.researchTools.converterNotes.scannedPages, {
        pages: pages.length,
        model: transcribed.model.label,
      }),
    );
  }

  onProgress?.({ step: "documentStructure" });
  const converted = await runPandoc({ source: "latex", target, text: latex.tex });
  const figures = extracted.figures.map((figure) => ({
    path: `assets/${figure.name}`,
    dataBase64: dataUrlBase64(figure.pngDataUrl),
  }));
  return {
    ...converted,
    files: [...figures, ...converted.files],
    note: i18n.t(($) => $.researchTools.converterNotes.extracted, {
      pages: latex.report.pages,
      figures: latex.report.figures,
    }),
  };
}

interface MermaidTarget {
  kind: "latex" | "typst";
  typstVersion?: string | null;
}

async function editableMermaid(source: string, target: MermaidTarget): Promise<ConverterOutputDraft> {
  if (target.kind === "latex") {
    return {
      text: mermaidToTikz(source),
      note: i18n.t(($) => $.researchTools.converterNotes.mermaidTikz),
    };
  }
  const { fletcherVersionFor } = await import("@oleafly/diagram/fletcher");
  return {
    text: mermaidToFletcher(source, fletcherVersionFor(target.typstVersion ?? null)),
    note: i18n.t(($) => $.researchTools.converterNotes.mermaidFletcher),
  };
}

interface ConverterOutputDraft {
  text: string;
  note: string;
}

function renderedMermaidFigure(target: MermaidTarget): string {
  if (target.kind === "typst") {
    return [
      "#figure(",
      '  image("assets/diagram.png", width: 100%),',
      ")",
    ].join("\n");
  }
  return [
    "% Add \\usepackage{graphicx} to your preamble.",
    "\\begin{figure}[htbp]",
    "  \\centering",
    "  \\includegraphics[width=\\linewidth]{assets/diagram.png}",
    "\\end{figure}",
  ].join("\n");
}

async function mermaidOutput(
  definition: AdHocConverterDefinition,
  source: string,
  target: MermaidTarget,
  onProgress?: ConverterProgressReporter,
  signal?: AbortSignal,
): Promise<ConverterOutput> {
  if (source.length > 50_000) {
    throw new Error(i18n.t(($) => $.researchTools.mermaidErrors.tooLarge));
  }
  let editable: ConverterOutputDraft | null = null;
  try {
    editable = await editableMermaid(source, target);
  } catch {
    editable = null;
  }
  if (editable) return textOutput(definition, editable.text, [], editable.note);
  onProgress?.({ step: "mermaid" });
  const [{ renderDiagram }, { svgDocumentToPngBytes }, exporter] = await Promise.all([
    import("@/components/ui/mermaid-diagram"),
    import("@/features/equation-export"),
    import("@/features/mermaid-export"),
  ]);
  const diagram = await renderDiagram(exporter.mermaidExportSource(source), "light");
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  const { svg, width, height } = exporter.standaloneMermaidSvg(diagram, source);
  const png = await svgDocumentToPngBytes(svg, exporter.mermaidRasterScale(width, height), "#ffffff");
  return textOutput(
    definition,
    renderedMermaidFigure(target),
    [{ path: "assets/diagram.png", dataBase64: bytesToBase64(png) }],
    target.kind === "typst"
      ? i18n.t(($) => $.researchTools.converterNotes.mermaidRenderedTypst)
      : i18n.t(($) => $.researchTools.converterNotes.mermaidRendered),
  );
}

async function tableOutput(
  definition: AdHocConverterDefinition,
  fileName: string,
  bytes: Uint8Array,
  target: "latex" | "typst",
  onProgress?: ConverterProgressReporter,
): Promise<ConverterOutput> {
  onProgress?.({ step: "firstSheet" });
  const rows = await readTableRowsFromBytes(fileName, bytes);
  if (rows.length === 0) throw new Error(i18n.t(($) => $.researchTools.converterErrors.emptySheet));
  return textOutput(
    definition,
    emitTable(rows, { target, header: true, boldHeader: true }),
    [],
    i18n.t(($) => $.researchTools.converterNotes.tableConverted, {
      rows: rows.length.toLocaleString(),
      columns: Math.max(...rows.map((row) => row.length)).toLocaleString(),
    }),
  );
}

async function equationLatex(
  input: ConverterInput,
  text: string,
  onProgress?: ConverterProgressReporter,
  signal?: AbortSignal,
): Promise<string> {
  if (input.file) {
    const image = await readImageInput(requireFile(input));
    const model = await resolveToolsModel("image");
    onProgress?.({ step: "readingEquation", model: model.label });
    return transcribeImage(model, image, { target: "LaTeX", mode: "equation", fragment: true, signal });
  }
  const normalized = normalizeEquation(text);
  if (normalized) return normalized;
  const model = await resolveToolsModel("equation-text");
  onProgress?.({ step: "convertingEquation", model: model.label });
  return transcribeEquationText(model, text, signal);
}

interface ArxivSource {
  archiveName: string;
  mainFile: string;
  mainSource: string;
  files: AdHocArtifact[];
}

async function arxivSource(
  input: ConverterInput,
  text: string,
  onProgress?: ConverterProgressReporter,
): Promise<ArxivSource> {
  if (!text && !input.file) throw new Error(i18n.t(($) => $.researchTools.converterErrors.arxivInputRequired));
  onProgress?.({ step: input.file ? "unpackingSource" : "downloadingSource" });
  return extractArxivSource({
    arxivId: input.file ? undefined : text,
    dataBase64: input.file
      ? bytesToBase64(new Uint8Array(await requireFile(input).arrayBuffer()))
      : undefined,
  });
}

function checkDetails(check: AdHocCheck | undefined): string[] {
  return (check?.diagnostics ?? []).map((diagnostic) =>
    diagnostic.line === null
      ? diagnostic.message
      : i18n.t(($) => $.researchTools.converterNotes.checkLine, {
          line: diagnostic.line,
          message: diagnostic.message,
        }),
  );
}

function arxivTypstNote(mainFile: string, check: AdHocCheck | undefined, skipped: number): string {
  const parts = [i18n.t(($) => $.researchTools.converterNotes.arxivTypstConverted, { mainFile })];
  if (check) {
    const errors = check.diagnostics.filter((diagnostic) => diagnostic.severity === "error").length;
    parts.push(
      check.ok
        ? i18n.t(($) => $.researchTools.converterNotes.typstCheckPassed)
        : i18n.t(($) => $.researchTools.converterNotes.typstCheckFailed, { count: Math.max(errors, 1) }),
    );
  }
  if (skipped > 0) {
    parts.push(i18n.t(($) => $.researchTools.converterNotes.notConverted, { count: skipped }));
  }
  return parts.join(" ");
}

async function arxivToTypst(
  definition: AdHocConverterDefinition,
  input: ConverterInput,
  text: string,
  onProgress?: ConverterProgressReporter,
  signal?: AbortSignal,
): Promise<ConverterOutput> {
  const source = await arxivSource(input, text, onProgress);
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  onProgress?.({ step: "convertingSource" });
  const support = typstSupportFiles(source.files, source.mainFile);
  const converted = await pandocConvert({
    source: "latex",
    target: "typst",
    text: flattenLatexInputs(source.mainSource, source.mainFile, source.files),
    report: true,
    check: true,
    files: support,
  });
  const report = converted.report ?? [];
  const extracted = converted.files.filter((file) => !support.some((entry) => entry.path === file.path));
  return {
    kind: "text",
    text: converted.text ?? "",
    dataBase64: null,
    fileName: definition.outputFileName,
    mediaType: definition.outputMediaType,
    files: [...support, ...extracted],
    mainFile: CONVERTED_MAIN_FILE,
    note: arxivTypstNote(source.mainFile, converted.check, report.length),
    details: [...new Set([...checkDetails(converted.check), ...report])],
  };
}

async function fileBytes(input: ConverterInput): Promise<{ name: string; bytes: Uint8Array }> {
  const file = requireFile(input);
  return { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) };
}

export async function runAdHocConverter(
  id: ConverterToolId,
  input: ConverterInput,
  onProgress?: ConverterProgressReporter,
  signal?: AbortSignal,
): Promise<ConverterOutput> {
  const definition = AD_HOC_CONVERTERS[id];
  const text = input.text.trim();
  switch (id) {
    case "html-to-latex":
      return runPandoc({ source: "html", target: "latex", text });
    case "html-to-typst":
      return runPandoc({ source: "html", target: "typst", text });
    case "latex-to-html":
      return runPandoc({ source: "latex", target: "html", text });
    case "latex-to-markdown":
      return runPandoc({ source: "latex", target: "markdown", text });
    case "latex-to-typst":
      return runPandoc({ source: "latex", target: "typst", text });
    case "latex-to-word":
      return runPandoc({ source: "latex", target: "docx", text });
    case "markdown-to-latex":
      return runPandoc({ source: "markdown", target: "latex", text });
    case "markdown-to-typst":
      return runPandoc({ source: "markdown", target: "typst", text });
    case "typst-to-latex":
      return runPandoc({ source: "typst", target: "latex", text });
    case "typst-to-html":
      return runPandoc({ source: "typst", target: "html", text });
    case "typst-to-markdown":
      return runPandoc({ source: "typst", target: "markdown", text });
    case "typst-to-word":
      return runPandoc({ source: "typst", target: "docx", text });
    case "word-to-latex":
    case "word-to-typst": {
      const { bytes } = await fileBytes(input);
      return runPandoc({
        source: "docx",
        target: id === "word-to-typst" ? "typst" : "latex",
        dataBase64: bytesToBase64(bytes),
      });
    }
    case "excel-to-latex":
    case "excel-to-typst": {
      const { name, bytes } = await fileBytes(input);
      return tableOutput(definition, name, bytes, id === "excel-to-typst" ? "typst" : "latex", onProgress);
    }
    case "csv-to-typst":
      return tableOutput(definition, "table.csv", new TextEncoder().encode(text), "typst", onProgress);
    case "image-to-latex":
    case "image-to-typst": {
      const image = await readImageInput(requireFile(input));
      const model = await resolveToolsModel("image");
      onProgress?.({ step: "visionModel", model: model.label });
      const target = id === "image-to-typst" ? "Typst" : "LaTeX";
      return textOutput(
        definition,
        await transcribeImage(model, image, {
          target,
          mode: "image",
          fragment: true,
          signal,
          typstVersion: input.typstVersion,
        }),
      );
    }
    case "equation-to-latex":
      return textOutput(definition, await equationLatex(input, text, onProgress, signal));
    case "equation-to-typst": {
      const latex = await equationLatex(input, text, onProgress, signal);
      return textOutput(definition, await latexMathToTypst(latex, input.typstVersion));
    }
    case "mermaid-to-latex":
      return mermaidOutput(definition, text, { kind: "latex" }, onProgress, signal);
    case "mermaid-to-typst":
      return mermaidOutput(
        definition,
        text,
        { kind: "typst", typstVersion: input.typstVersion },
        onProgress,
        signal,
      );
    case "pdf-to-markdown":
      return pdfToText(definition, input, "markdown", onProgress, signal);
    case "pdf-to-typst":
      return pdfToText(definition, input, "typst", onProgress, signal);
    case "arxiv-to-typst":
      return arxivToTypst(definition, input, text, onProgress, signal);
    case "arxiv-to-latex": {
      const source = await arxivSource(input, text, onProgress);
      return {
        kind: "bundle",
        text: source.mainSource,
        dataBase64: null,
        fileName: `${source.archiveName}.zip`,
        mediaType: "application/zip",
        files: source.files,
        mainFile: source.mainFile,
        note: i18n.t(($) => $.researchTools.converterNotes.arxivBundle, {
          files: source.files.length.toLocaleString(),
          mainFile: source.mainFile,
        }),
      };
    }
  }
}
