import { stex, stexMath } from "@codemirror/legacy-modes/mode/stex";
import { LanguageSupport, StreamLanguage } from "@codemirror/language";
import { type EditorState } from "@codemirror/state";
import {
  closeCompletion,
  snippet,
  type Completion,
  type CompletionContext,
  type CompletionResult,
  insertCompletionText,
} from "@codemirror/autocomplete";
import {
  isLatexCompletionPosition,
  latexBalancedGroupEnd,
  latexIgnoredRangesField,
  maskLatexIgnoredRegions,
} from "./latex-lexical";
import { environmentSnippet } from "./latex-environments";
import {
  completionRequestIsCurrent,
  createCompletionRequestGuard,
  type CompletionRequestGuard,
} from "./completion-request";
import { validateXparseArgumentSpecification } from "./latex-xparse";
import { editorMessage, type EditorMessageKey } from "./messages";
import {
  boundedCompletionContext,
  shouldRunCompletionSource,
} from "./completion-trigger";

let bibKeysProvider: () => string[] = () => [];
export function setBibKeysProvider(fn: () => string[]) {
  bibKeysProvider = fn;
}

/**
 * Corpus-backed completion data supplied by the host application. Getters
 * return null while the corpus is still loading so callers can fall back to
 * the built-in lists.
 */
export interface LatexCorpusProvider {
  coreCommands(): readonly Completion[] | null;
}

let corpusProvider: LatexCorpusProvider | null = null;
export function setLatexCorpusProvider(
  provider: LatexCorpusProvider | null,
) {
  corpusProvider = provider;
}

const latexLanguageData = {
  closeBrackets: {
    brackets: ["(", "[", "{", "'", '"'],
    before: ")]}:;>$",
  },
  commentTokens: { line: "%" },
};

export const latexLanguage = () =>
  new LanguageSupport(
    StreamLanguage.define({ ...stex, languageData: latexLanguageData }),
    [latexIgnoredRangesField],
  );

/** For content that's bare math (no surrounding $...$ or \[...\]), e.g. the equation preview tool. */
export const latexMathLanguage = () =>
  new LanguageSupport(StreamLanguage.define(stexMath));

function labelsInDocument(state: { doc: { toString: () => string } }): string[] {
  return latexCatalog(state).labels;
}

let standardEnvironmentNames: Set<string> | null = null;

export function isStandardLatexEnvironment(name: string): boolean {
  standardEnvironmentNames ??= new Set<string>(STANDARD_ENVIRONMENTS);
  return standardEnvironmentNames.has(name);
}

export function bibKeysFromSources(sources: Iterable<string>): string[] {
  const out: string[] = [];
  for (const content of sources) {
    const re = /@\w+\s*\{\s*([^,\s}]+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content))) out.push(m[1]);
  }
  return out;
}

function cmd(
  label: string,
  detail: EditorMessageKey,
  template?: string,
): Completion {
  return {
    label,
    type: "function",
    detail: editorMessage(detail),
    apply: template ? snippet(template) : undefined,
  };
}

function latexCommands(): Completion[] {
  return [
    cmd(String.raw`\documentclass`, "latex.command.documentclass", "\\documentclass{${1}}"),
    cmd(String.raw`\begin`, "latex.command.begin", "\\begin{${1}}\n  ${2}\n\\end{${1}}"),
    cmd(String.raw`\end`, "latex.command.end", "\\end{${1}}"),
    cmd(String.raw`\textbf`, "latex.command.textbf", "\\textbf{${1}}"),
    cmd(String.raw`\textit`, "latex.command.textit", "\\textit{${1}}"),
    cmd(String.raw`\emph`, "latex.command.emph", "\\emph{${1}}"),
    cmd(String.raw`\underline`, "latex.command.underline", "\\underline{${1}}"),
    cmd(String.raw`\texttt`, "latex.command.texttt", "\\texttt{${1}}"),
    cmd(String.raw`\textsc`, "latex.command.textsc", "\\textsc{${1}}"),
    cmd(String.raw`\textsf`, "latex.command.textsf", "\\textsf{${1}}"),
    cmd(String.raw`\textrm`, "latex.command.textrm", "\\textrm{${1}}"),
    cmd(String.raw`\textcolor`, "latex.command.textcolor", "\\textcolor{${1}}{${2}}"),
    cmd(String.raw`\part`, "latex.command.part", "\\part{${1}}"),
    cmd(String.raw`\chapter`, "latex.command.chapter", "\\chapter{${1}}"),
    cmd(String.raw`\section`, "latex.command.section", "\\section{${1}}"),
    cmd(String.raw`\subsection`, "latex.command.subsection", "\\subsection{${1}}"),
    cmd(String.raw`\subsubsection`, "latex.command.subsubsection", "\\subsubsection{${1}}"),
    cmd(String.raw`\paragraph`, "latex.command.paragraph", "\\paragraph{${1}}"),
    cmd(String.raw`\subparagraph`, "latex.command.subparagraph", "\\subparagraph{${1}}"),
    cmd(String.raw`\item`, "latex.command.item", "\\item ${1}"),
    cmd(String.raw`\label`, "latex.command.label", "\\label{${1}}"),
    cmd(String.raw`\ref`, "latex.command.ref", "\\ref{${1}}"),
    cmd(String.raw`\eqref`, "latex.command.eqref", "\\eqref{${1}}"),
    cmd(String.raw`\pageref`, "latex.command.pageref", "\\pageref{${1}}"),
    cmd(String.raw`\autoref`, "latex.command.autoref", "\\autoref{${1}}"),
    cmd(String.raw`\cref`, "latex.command.cref", "\\cref{${1}}"),
    cmd(String.raw`\cite`, "latex.command.cite", "\\cite{${1}}"),
    cmd(String.raw`\parencite`, "latex.command.parencite", "\\parencite{${1}}"),
    cmd(String.raw`\textcite`, "latex.command.textcite", "\\textcite{${1}}"),
    cmd(String.raw`\footnote`, "latex.command.footnote", "\\footnote{${1}}"),
    cmd(String.raw`\usepackage`, "latex.command.usepackage", "\\usepackage{${1}}"),
    cmd(String.raw`\title`, "latex.command.title", "\\title{${1}}"),
    cmd(String.raw`\author`, "latex.command.author", "\\author{${1}}"),
    cmd(String.raw`\date`, "latex.command.date", "\\date{${1}}"),
    cmd(String.raw`\thanks`, "latex.command.thanks", "\\thanks{${1}}"),
    cmd(String.raw`\maketitle`, "latex.command.maketitle"),
    cmd(String.raw`\tableofcontents`, "latex.command.tableofcontents"),
    cmd(String.raw`\newpage`, "latex.command.newpage"),
    cmd(String.raw`\clearpage`, "latex.command.clearpage"),
    cmd(String.raw`\pagebreak`, "latex.command.pagebreak"),
    cmd(String.raw`\linebreak`, "latex.command.linebreak"),
    cmd(String.raw`\hspace`, "latex.command.hspace", "\\hspace{${1}}"),
    cmd(String.raw`\vspace`, "latex.command.vspace", "\\vspace{${1}}"),
    cmd(String.raw`\input`, "latex.command.input", "\\input{${1}}"),
    cmd(String.raw`\include`, "latex.command.include", "\\include{${1}}"),
    cmd(String.raw`\includegraphics`, "latex.command.includegraphics", "\\includegraphics[width=${1}\\textwidth]{${2}}"),
    cmd(String.raw`\caption`, "latex.command.caption", "\\caption{${1}}"),
    cmd(String.raw`\centering`, "latex.command.centering"),
    cmd(String.raw`\url`, "latex.command.url", "\\url{${1}}"),
    cmd(String.raw`\href`, "latex.command.href", "\\href{${1}}{${2}}"),
    cmd(String.raw`\addbibresource`, "latex.command.addbibresource", "\\addbibresource{${1}}"),
    cmd(String.raw`\bibliography`, "latex.command.bibliography", "\\bibliography{${1}}"),
    cmd(String.raw`\printbibliography`, "latex.command.printbibliography"),
    cmd(String.raw`\frac`, "latex.command.frac", "\\frac{${1}}{${2}}"),
    cmd(String.raw`\sqrt`, "latex.command.sqrt", "\\sqrt{${1}}"),
    cmd(String.raw`\overline`, "latex.command.overline", "\\overline{${1}}"),
    cmd(String.raw`\vec`, "latex.command.vec", "\\vec{${1}}"),
    cmd(String.raw`\hat`, "latex.command.hat", "\\hat{${1}}"),
    cmd(String.raw`\mathrm`, "latex.command.mathrm", "\\mathrm{${1}}"),
    cmd(String.raw`\mathbf`, "latex.command.mathbf", "\\mathbf{${1}}"),
    cmd(String.raw`\mathcal`, "latex.command.mathcal", "\\mathcal{${1}}"),
    cmd(String.raw`\mathbb`, "latex.command.mathbb", "\\mathbb{${1}}"),
    cmd(String.raw`\operatorname`, "latex.command.operatorname", "\\operatorname{${1}}"),
    cmd(String.raw`\sum`, "latex.command.sum"),
    cmd(String.raw`\prod`, "latex.command.prod"),
    cmd(String.raw`\int`, "latex.command.int"),
    cmd(String.raw`\lim`, "latex.command.lim"),
    cmd(String.raw`\itemize`, "latex.command.itemize", "\\begin{itemize}\n  \\item ${1}\n\\end{itemize}"),
    cmd(String.raw`\enumerate`, "latex.command.enumerate", "\\begin{enumerate}\n  \\item ${1}\n\\end{enumerate}"),
    cmd(String.raw`\equation`, "latex.command.equation", "\\begin{equation}\n  ${1}\n\\end{equation}"),
    cmd(String.raw`\align`, "latex.command.align", "\\begin{align}\n  ${1}\n\\end{align}"),
  ];
}

const STANDARD_ENVIRONMENT_BOOST = 1;

export const STANDARD_ENVIRONMENTS = [
  "document",
  "abstract",
  "itemize",
  "enumerate",
  "description",
  "figure",
  "figure*",
  "table",
  "table*",
  "tabular",
  "tabularx",
  "equation",
  "equation*",
  "align",
  "align*",
  "gather",
  "gather*",
  "multline",
  "multline*",
  "split",
  "cases",
  "array",
  "matrix",
  "pmatrix",
  "bmatrix",
  "Bmatrix",
  "vmatrix",
  "Vmatrix",
  "theorem",
  "proof",
  "center",
  "flushleft",
  "flushright",
  "quote",
  "quotation",
  "verbatim",
  "minipage",
  "tikzpicture",
] as const;

const STANDARD_CLASSES = [
  "article",
  "report",
  "book",
  "letter",
  "beamer",
  "memoir",
  "scrartcl",
  "scrreprt",
  "scrbook",
] as const;

const STANDARD_PACKAGES = [
  "amsmath",
  "amssymb",
  "mathtools",
  "graphicx",
  "xcolor",
  "hyperref",
  "cleveref",
  "geometry",
  "booktabs",
  "tabularx",
  "array",
  "microtype",
  "biblatex",
  "natbib",
  "csquotes",
  "enumitem",
  "siunitx",
  "tikz",
  "pgfplots",
  "fontspec",
  "inputenc",
  "fontenc",
  "babel",
  "polyglossia",
  "listings",
  "minted",
  "algorithm2e",
  "caption",
  "subcaption",
  "setspace",
  "fancyhdr",
  "titlesec",
] as const;

interface LocalCommand {
  label: string;
  detail: string;
  template: string;
}

interface LocalLatexCatalog {
  commands: LocalCommand[];
  environments: string[];
  labels: string[];
  packages: string[];
}

const catalogCache = new WeakMap<object, LocalLatexCatalog>();

function commandArgumentCount(parameterText: string): number {
  let highest = 0;
  for (const match of parameterText.matchAll(/#([1-9])/gu)) {
    highest = Math.max(highest, Number(match[1]));
  }
  return highest;
}

interface ParsedGroup {
  content: string;
  from: number;
  to: number;
}

function skipWhitespace(text: string, start: number): number {
  let cursor = start;
  while (/\s/u.test(text[cursor] ?? "")) cursor += 1;
  return cursor;
}

function parsedGroup(
  text: string,
  start: number,
  opening = "{",
  closing = "}",
): ParsedGroup | null {
  const from = skipWhitespace(text, start);
  const to = latexBalancedGroupEnd(text, from, opening, closing);
  if (to === null) return null;
  return {
    content: text.slice(from + 1, to - 1),
    from,
    to,
  };
}

function parsedControlSequence(
  text: string,
  start: number,
): { label: string; to: number } | null {
  const from = skipWhitespace(text, start);
  if (text[from] === "{") {
    const group = parsedGroup(text, from);
    if (!group) return null;
    const label = group.content.trim();
    if (!/^\\(?:[A-Za-z@]+|.)$/u.test(label)) return null;
    return { label, to: group.to };
  }
  const match = /^\\(?:[A-Za-z@]+|.)/u.exec(text.slice(from));
  if (!match) return null;
  return { label: match[0], to: from + match[0].length };
}

function snippetDefault(value: string): string {
  return value.trim().replace(/[\\$}]/gu, String.raw`\$&`);
}

function argumentDetail(
  required: number,
  optional: number,
  specification?: string,
): string {
  if (specification !== undefined) {
    return specification
      ? editorMessage("latex.macro.xparse", { specification })
      : editorMessage("latex.macro.xparseNoArguments");
  }
  const total = required + optional;
  if (total === 0) return editorMessage("latex.macro.plain");
  if (optional === 0) {
    return editorMessage("latex.macro.arguments", { count: required });
  }
  if (required === 0) {
    return editorMessage("latex.macro.optionalArguments", { count: optional });
  }
  return editorMessage("latex.macro.mixedArguments", { optional, required });
}

function classicCommandDefinition(
  text: string,
  start: number,
): LocalCommand | null {
  const name = parsedControlSequence(text, start);
  if (!name) return null;
  let cursor = name.to;
  let count = 0;
  let defaultValue: string | null = null;
  const countGroup = parsedGroup(text, cursor, "[", "]");
  if (countGroup && /^\d$/u.test(countGroup.content.trim())) {
    count = Number(countGroup.content.trim());
    cursor = countGroup.to;
    const defaultGroup = parsedGroup(text, cursor, "[", "]");
    if (defaultGroup) {
      defaultValue = defaultGroup.content;
      cursor = defaultGroup.to;
    }
  }
  if (!parsedGroup(text, cursor)) return null;

  let template = name.label;
  let required = count;
  let optional = 0;
  for (let index = 1; index <= count; index += 1) {
    if (index === 1 && defaultValue !== null) {
      template += `[${"${"}${index}:${snippetDefault(defaultValue)}}]`;
      required -= 1;
      optional += 1;
    } else {
      template += `{${"${"}${index}}}`;
    }
  }
  return {
    label: name.label,
    detail: argumentDetail(required, optional),
    template,
  };
}

function xparseDelimiter(
  specification: string,
  start: number,
): { value: string; to: number } {
  const cursor = skipWhitespace(specification, start);
  if (specification[cursor] === "{") {
    const group = parsedGroup(specification, cursor);
    if (group) return { value: group.content, to: group.to };
  }
  if (specification[cursor] === "\\") {
    const controlSequence = /^\\(?:[A-Za-z@]+|.)/u.exec(
      specification.slice(cursor),
    )?.[0];
    if (controlSequence) {
      return {
        value: controlSequence,
        to: cursor + controlSequence.length,
      };
    }
  }
  return {
    value: specification[cursor] ?? "",
    to: Math.min(specification.length, cursor + 1),
  };
}

interface XparseTemplateStep {
  readonly cursor: number;
  readonly snippet: string;
}

function xparseDefaultedOptional(
  specification: string,
  cursor: number,
  placeholder: number,
): XparseTemplateStep {
  const defaultGroup = parsedGroup(specification, cursor);
  const value = snippetDefault(defaultGroup?.content ?? "");
  const suffix = value ? `:${value}` : "";
  return {
    cursor: defaultGroup?.to ?? cursor,
    snippet: `[${"${"}${placeholder}${suffix}}]`,
  };
}

function xparseSwitchArgument(
  kind: string,
  specification: string,
  cursor: number,
  placeholder: number,
): XparseTemplateStep {
  const next =
    kind === "t" ? xparseDelimiter(specification, cursor).to : cursor;
  return { cursor: next, snippet: `${"${"}${placeholder}}` };
}

function xparseDelimitedArgument(
  kind: string,
  specification: string,
  cursor: number,
  placeholder: number,
): XparseTemplateStep {
  const left = xparseDelimiter(specification, cursor);
  const right = xparseDelimiter(specification, left.to);
  const next =
    kind === "R" || kind === "D"
      ? (parsedGroup(specification, right.to)?.to ?? right.to)
      : right.to;
  return {
    cursor: next,
    snippet: `${left.value}${"${"}${placeholder}}${right.value}`,
  };
}

function xparseEmbellishedArgument(
  kind: string,
  specification: string,
  cursor: number,
  placeholder: number,
): XparseTemplateStep {
  const afterKeys = parsedGroup(specification, cursor)?.to ?? cursor;
  const next =
    kind === "E" ? (parsedGroup(specification, afterKeys)?.to ?? afterKeys) : afterKeys;
  return { cursor: next, snippet: `${"${"}${placeholder}}` };
}

function xparseTemplateStep(
  kind: string,
  specification: string,
  cursor: number,
  placeholder: number,
): XparseTemplateStep | null {
  switch (kind) {
    case "+":
    case "!":
      return { cursor, snippet: "" };
    case ">":
      return {
        cursor: parsedGroup(specification, cursor)?.to ?? cursor,
        snippet: "",
      };
    case "m":
    case "b":
    case "v":
      return { cursor, snippet: `{${"${"}${placeholder}}}` };
    case "o":
      return { cursor, snippet: `[${"${"}${placeholder}}]` };
    case "O":
      return xparseDefaultedOptional(specification, cursor, placeholder);
    case "s":
    case "t":
      return xparseSwitchArgument(kind, specification, cursor, placeholder);
    case "r":
    case "R":
    case "d":
    case "D":
      return xparseDelimitedArgument(kind, specification, cursor, placeholder);
    case "e":
    case "E":
      return xparseEmbellishedArgument(
        kind,
        specification,
        cursor,
        placeholder,
      );
    default:
      return null;
  }
}

function xparseCommandTemplate(
  label: string,
  specification: string,
): string {
  let template = label;
  let cursor = 0;
  let placeholder = 1;
  while (cursor < specification.length) {
    cursor = skipWhitespace(specification, cursor);
    const kind = specification[cursor];
    if (!kind) break;
    cursor += 1;

    const step = xparseTemplateStep(kind, specification, cursor, placeholder);
    if (!step) continue;
    cursor = step.cursor;
    if (step.snippet) {
      template += step.snippet;
      placeholder += 1;
    }
  }
  return template;
}

function xparseCommandDefinition(
  text: string,
  start: number,
): LocalCommand | null {
  const name = parsedControlSequence(text, start);
  if (!name) return null;
  const specification = parsedGroup(text, name.to);
  if (!specification) return null;
  if (
    validateXparseArgumentSpecification(specification.content).length >
    0
  ) {
    return null;
  }
  if (!parsedGroup(text, specification.to)) return null;
  const normalizedSpecification = specification.content.trim();
  return {
    label: name.label,
    detail: argumentDetail(0, 0, normalizedSpecification),
    template: xparseCommandTemplate(
      name.label,
      normalizedSpecification,
    ),
  };
}

function collectPackageNames(
  text: string,
  packages: Set<string>,
): void {
  const directive = /\\(?:usepackage|RequirePackage)/gu;
  let match: RegExpExecArray | null;
  while ((match = directive.exec(text))) {
    let cursor = skipWhitespace(text, match.index + match[0].length);
    if (text[cursor] === "[") {
      const optionsEnd = latexBalancedGroupEnd(text, cursor, "[", "]");
      // An unclosed option group owns the rest of the source. Stop instead of
      // repeatedly rescanning that suffix from every command-like substring.
      if (optionsEnd === null) break;
      cursor = skipWhitespace(text, optionsEnd);
    }
    if (text[cursor] !== "{") continue;
    const namesEnd = latexBalancedGroupEnd(text, cursor);
    if (namesEnd === null) break;
    const names = text.slice(cursor + 1, namesEnd - 1);
    for (const name of names.split(",")) {
      const normalized = name.trim().toLowerCase();
      if (normalized) packages.add(normalized);
    }
    directive.lastIndex = namesEnd;
  }
}

/**
 * Builds the current-revision fallback catalog in one linear pass per
 * immutable CodeMirror document. Project intelligence can add cross-file
 * symbols, but completion must not disappear while that service starts or
 * while another file is malformed.
 */
function collectClassicCommands(
  catalogText: string,
  commands: Map<string, LocalCommand>,
): void {
  for (const match of catalogText.matchAll(
    /\\(?:newcommand|renewcommand|providecommand|DeclareRobustCommand)\*?/gu,
  )) {
    const definition = classicCommandDefinition(
      catalogText,
      (match.index ?? 0) + match[0].length,
    );
    if (definition) commands.set(definition.label, definition);
  }
}

function collectXparseCommands(
  catalogText: string,
  commands: Map<string, LocalCommand>,
): void {
  for (const match of catalogText.matchAll(
    /\\(?:New|Renew|Provide|Declare)DocumentCommand\*?/gu,
  )) {
    const definition = xparseCommandDefinition(
      catalogText,
      (match.index ?? 0) + match[0].length,
    );
    if (definition) commands.set(definition.label, definition);
  }
}

function primitiveDefinitionTemplate(
  label: string,
  argumentCount: number,
): string {
  let template = label;
  for (let index = 1; index <= argumentCount; index += 1) {
    template += `{${"${"}${index}}}`;
  }
  return template;
}

function collectPrimitiveDefinitions(
  catalogText: string,
  commands: Map<string, LocalCommand>,
): void {
  for (const match of catalogText.matchAll(
    /\\(?:def|gdef|edef|xdef)\s*(\\(?:[A-Za-z@]+|.))((?:\s*#[1-9])*)/gu,
  )) {
    const label = match[1];
    if (!label) continue;
    const bodyStart =
      (match.index ?? 0) + match[0].length;
    if (!parsedGroup(catalogText, bodyStart)) continue;
    const argumentCount = commandArgumentCount(match[2] ?? "");
    commands.set(label, {
      label,
      detail: argumentDetail(argumentCount, 0),
      template: primitiveDefinitionTemplate(label, argumentCount),
    });
  }
}

const ENVIRONMENT_DEFINITION_PATTERNS = [
  /\\(?:newenvironment|renewenvironment)\*?\s*\{\s*([^{}\s]+)\s*\}/gu,
  /\\(?:New|Renew|Provide|Declare)DocumentEnvironment\s*\{\s*([^{}\s]+)\s*\}/gu,
  /\\newtheorem\*?\s*\{\s*([^{}\s]+)\s*\}/gu,
];

function collectEnvironmentNames(
  catalogText: string,
  environments: Set<string>,
): void {
  for (const pattern of ENVIRONMENT_DEFINITION_PATTERNS) {
    for (const match of catalogText.matchAll(pattern)) {
      if (match[1]) environments.add(match[1]);
    }
  }
}

function collectLabelNames(catalogText: string, labels: Set<string>): void {
  for (const match of catalogText.matchAll(/\\label\s*\{([^}]{1,500})\}/gu)) {
    const label = match[1]?.trim();
    if (label) labels.add(label);
  }
}

function latexCatalog(state: {
  doc: { toString: () => string };
}): LocalLatexCatalog {
  const cacheKey = state.doc as object;
  const cached = catalogCache.get(cacheKey);
  if (cached) return cached;

  const text = state.doc.toString();
  const catalogText = maskLatexIgnoredRegions(text);
  const commands = new Map<string, LocalCommand>();
  const environments = new Set<string>();
  const labels = new Set<string>();
  const packages = new Set<string>();

  collectClassicCommands(catalogText, commands);
  collectXparseCommands(catalogText, commands);
  collectPrimitiveDefinitions(catalogText, commands);
  collectEnvironmentNames(catalogText, environments);
  collectLabelNames(catalogText, labels);
  collectPackageNames(catalogText, packages);

  const catalog = {
    commands: [...commands.values()],
    environments: [...environments],
    labels: [...labels],
    packages: [...packages],
  };
  catalogCache.set(cacheKey, catalog);
  return catalog;
}

function guardedLocalCompletion(
  guard: CompletionRequestGuard,
  label: string,
  type: Completion["type"],
  detail: string,
  template = label,
): Completion {
  return {
    label,
    type,
    detail,
    apply: (view, completion, from, to) => {
      if (!completionRequestIsCurrent(guard, view.state)) {
        closeCompletion(view);
        return;
      }
      if (template !== label) {
        snippet(template)(view, completion, from, to);
        return;
      }
      view.dispatch(insertCompletionText(view.state, label, from, to));
    },
  };
}

function guardedEnvironmentCompletion(
  guard: CompletionRequestGuard,
  name: string,
  detail: string,
): Completion {
  return {
    label: name,
    type: "type",
    detail,
    boost: STANDARD_ENVIRONMENT_BOOST,
    apply: (view, completion, from, to) => {
      if (!completionRequestIsCurrent(guard, view.state)) {
        closeCompletion(view);
        return;
      }
      if (view.state.selection.ranges.length > 1) {
        view.dispatch(insertCompletionText(view.state, name, from, to));
        return;
      }
      const end = view.state.sliceDoc(to, to + 1) === "}" ? to + 1 : to;
      snippet(environmentSnippet(name))(view, completion, from, end);
    },
  };
}
function guardCompletionForSource(
  guard: CompletionRequestGuard,
  option: Completion,
): Completion {
  const originalApply = option.apply;
  return {
    ...option,
    apply: (view, completion, from, to) => {
      if (!completionRequestIsCurrent(guard, view.state)) {
        closeCompletion(view);
        return;
      }
      if (typeof originalApply === "function") {
        originalApply(view, completion, from, to);
        return;
      }
      const insert =
        typeof originalApply === "string"
          ? originalApply
          : String(option.label);
      view.dispatch(insertCompletionText(view.state, insert, from, to));
    },
  };
}

function localCommandCompletions(
  state: EditorState,
  guard: CompletionRequestGuard,
): Completion[] {
  return latexCatalog(state).commands.map(({ label, detail, template }) => {
    return guardedLocalCompletion(
      guard,
      label,
      "function",
      detail,
      template,
    );
  });
}

// Package-aware additions keep completion useful even before an LSP is
// installed. The project language service can still contribute richer symbols
// when TexLab is available.
function packageCommands(): Record<string, Completion[]> {
  return {
    amsmath: [
      cmd(String.raw`\dfrac`, "latex.packageCommand.dfrac", "\\dfrac{${1}}{${2}}"),
      cmd(
        String.raw`\DeclareMathOperator`,
        "latex.packageCommand.declareMathOperator",
        "\\DeclareMathOperator{${1}}{${2}}",
      ),
    ],
    amssymb: [cmd(String.raw`\mathbb`, "latex.packageCommand.mathbb")],
    graphicx: [
      cmd(String.raw`\rotatebox`, "latex.packageCommand.rotatebox", "\\rotatebox{${1}}{${2}}"),
    ],
    hyperref: [
      cmd(String.raw`\hypersetup`, "latex.packageCommand.hypersetup", "\\hypersetup{${1}}"),
    ],
    booktabs: [
      cmd(String.raw`\toprule`, "latex.packageCommand.toprule"),
      cmd(String.raw`\midrule`, "latex.packageCommand.midrule"),
      cmd(String.raw`\bottomrule`, "latex.packageCommand.bottomrule"),
    ],
    siunitx: [
      cmd(String.raw`\SI`, "latex.packageCommand.si", "\\SI{${1}}{${2}}"),
      cmd(String.raw`\num`, "latex.packageCommand.num", "\\num{${1}}"),
    ],
  };
}

function packageCompletions(
  state: EditorState,
  guard: CompletionRequestGuard,
): Completion[] {
  const table = packageCommands();
  return latexCatalog(state).packages.flatMap((name) =>
    (table[name] ?? []).map((option) =>
      guardCompletionForSource(guard, option),
    ),
  );
}

function uniqueCompletions(options: Completion[]): Completion[] {
  const seen = new Set<string>();
  return options.filter((option) => {
    const key = String(option.label);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function currentArgumentQuery(text: string): string {
  const open = text.lastIndexOf("{");
  const value = open >= 0 ? text.slice(open + 1) : text;
  const comma = value.lastIndexOf(",");
  return value.slice(comma + 1).trimStart();
}

interface OpenCommandArgument {
  readonly text: string;
}

function controlWordEnd(prefix: string, start: number): number {
  let cursor = start;
  while (/[A-Za-z@]/u.test(prefix[cursor] ?? "")) cursor += 1;
  return cursor;
}

function skipOptionalGroups(
  prefix: string,
  start: number,
  groups: number,
): number | null {
  let cursor = start;
  for (let group = 0; group < groups && prefix[cursor] === "["; group += 1) {
    const groupEnd = latexBalancedGroupEnd(prefix, cursor, "[", "]");
    if (groupEnd === null) return null;
    cursor = skipWhitespace(prefix, groupEnd);
  }
  return cursor;
}

function openArgumentStartsAt(
  prefix: string,
  commandStart: number,
  commands: ReadonlySet<string>,
  options: {
    readonly allowStar?: boolean;
    readonly optionalGroups?: number;
  },
): boolean {
  let cursor = controlWordEnd(prefix, commandStart + 1);
  if (!commands.has(prefix.slice(commandStart + 1, cursor))) return false;
  if (options.allowStar && prefix[cursor] === "*") cursor += 1;
  const afterGroups = skipOptionalGroups(
    prefix,
    skipWhitespace(prefix, cursor),
    options.optionalGroups ?? 0,
  );
  if (afterGroups === null) return false;
  if (prefix[afterGroups] !== "{") return false;
  const argument = prefix.slice(afterGroups + 1);
  return (
    argument.length <= 500 &&
    !argument.includes("{") &&
    !argument.includes("}")
  );
}

function openCommandArgument(
  context: CompletionContext,
  commands: ReadonlySet<string>,
  options: {
    readonly allowStar?: boolean;
    readonly optionalGroups?: number;
  } = {},
): OpenCommandArgument | null {
  const line = context.state.doc.lineAt(context.pos);
  const sliceFrom = Math.max(line.from, context.pos - 2_048);
  const prefix = context.state.doc.sliceString(sliceFrom, context.pos);
  let commandStart = prefix.lastIndexOf("\\");

  while (commandStart >= 0) {
    if (openArgumentStartsAt(prefix, commandStart, commands, options)) {
      return { text: prefix.slice(commandStart) };
    }
    if (commandStart === 0) break;
    commandStart = prefix.lastIndexOf("\\", commandStart - 1);
  }
  return null;
}

const PACKAGE_ARGUMENT_COMMANDS = new Set([
  "usepackage",
  "RequirePackage",
]);
const CLASS_ARGUMENT_COMMANDS = new Set(["documentclass"]);
const CITATION_ARGUMENT_COMMANDS = new Set([
  "cite",
  "citep",
  "citet",
  "citeauthor",
  "citeyear",
  "citealt",
  "parencite",
  "textcite",
  "autocite",
  "nocite",
]);

function structuralArgumentCompletions(
  context: CompletionContext,
  guard: CompletionRequestGuard,
): CompletionResult | null {
  const environmentMatch = context.matchBefore(
    /\\(?:begin|end)\s*\{[^{}]{0,500}$/u,
  );
  if (environmentMatch) {
    const opening = environmentMatch.text.startsWith(String.raw`\begin`);
    const query = currentArgumentQuery(environmentMatch.text);
    const local = latexCatalog(context.state).environments.map((name) =>
      opening
        ? guardedEnvironmentCompletion(
            guard,
            name,
            editorMessage("latex.completion.documentEnvironment"),
          )
        : guardedLocalCompletion(
            guard,
            name,
            "type",
            editorMessage("latex.completion.documentEnvironment"),
          ),
    );
    return {
      from: context.pos - query.length,
      options: uniqueCompletions([
        ...local,
        ...STANDARD_ENVIRONMENTS.map((name) =>
          opening
            ? guardedEnvironmentCompletion(
                guard,
                name,
                editorMessage("latex.completion.environment"),
              )
            : guardCompletionForSource(guard, {
                label: name,
                type: "type",
                detail: editorMessage("latex.completion.environment"),
                boost: STANDARD_ENVIRONMENT_BOOST,
              }),
        ),
      ]),
    };
  }

  const packageMatch = openCommandArgument(
    context,
    PACKAGE_ARGUMENT_COMMANDS,
    { optionalGroups: 1 },
  );
  if (packageMatch) {
    const query = currentArgumentQuery(packageMatch.text);
    return {
      from: context.pos - query.length,
      options: STANDARD_PACKAGES.map((name) =>
        guardCompletionForSource(guard, {
          label: name,
          type: "namespace",
          detail: editorMessage("latex.completion.package"),
        }),
      ),
    };
  }

  const classMatch = openCommandArgument(
    context,
    CLASS_ARGUMENT_COMMANDS,
    { optionalGroups: 1 },
  );
  if (classMatch) {
    const query = currentArgumentQuery(classMatch.text);
    return {
      from: context.pos - query.length,
      options: STANDARD_CLASSES.map((name) =>
        guardCompletionForSource(guard, {
          label: name,
          type: "type",
          detail: editorMessage("latex.completion.documentClass"),
        }),
      ),
    };
  }

  return null;
}

function referenceCitationCompletions(
  context: CompletionContext,
  guard: CompletionRequestGuard,
): CompletionResult | null {
  const refMatch = context.matchBefore(
    /\\(?:ref|eqref|pageref|autoref|cref|Cref|cpageref|vref|Vref|labelcref|nameref|namecref|fref|sref|labelref)\*?\s*\{[^}]{0,500}$/u
  );
  if (refMatch) {
    const labels = labelsInDocument(context.state);
    const query = currentArgumentQuery(refMatch.text);
    return {
      from: context.pos - query.length,
      options: labels.map((label) =>
        guardCompletionForSource(guard, {
          label,
          type: "variable",
          detail: editorMessage("latex.completion.label"),
        }),
      ),
    };
  }

  const citeMatch = openCommandArgument(
    context,
    CITATION_ARGUMENT_COMMANDS,
    { allowStar: true, optionalGroups: 1 },
  );
  if (citeMatch) {
    const query = currentArgumentQuery(citeMatch.text);
    return {
      from: context.pos - query.length,
      options: bibKeysProvider().map((label) =>
        guardCompletionForSource(guard, {
          label,
          type: "constant",
          detail: editorMessage("latex.completion.citation"),
        }),
      ),
    };
  }

  return null;
}

/**
 * Lightweight current-document reference/citation fallback. App hosts can
 * compose this after a revision-strict project source so autocomplete remains
 * useful while a newly typed query is waiting for project re-indexing.
 */
export function latexReferenceCitationCompletions(
  context: CompletionContext,
): CompletionResult | null {
  if (!shouldRunCompletionSource(context, "latex")) return null;
  const source = context.state.doc.toString();
  if (!isLatexCompletionPosition(source, context.pos)) return null;
  return referenceCitationCompletions(
    context,
    createCompletionRequestGuard(context),
  );
}

export function latexCompletions(
  context: CompletionContext
): CompletionResult | null {
  if (!shouldRunCompletionSource(context, "latex")) return null;
  const source = context.state.doc.toString();
  if (!isLatexCompletionPosition(source, context.pos)) return null;
  const guard = createCompletionRequestGuard(context);
  return (
    referenceCitationCompletions(context, guard) ??
    structuralArgumentCompletions(context, guard) ??
    commandCompletions(context, guard, true)
  );
}

function commandCompletions(
  context: CompletionContext,
  guard: CompletionRequestGuard,
  explicitFallback: boolean,
): CompletionResult | null {
  const cmdMatch = context.matchBefore(/\\[a-zA-Z@]*$/);
  if (!cmdMatch && !(explicitFallback && context.explicit)) return null;
  return {
    from: cmdMatch ? cmdMatch.from : context.pos,
    options: uniqueCompletions([
      ...localCommandCompletions(context.state, guard),
      ...latexCommands().map((option) =>
        guardCompletionForSource(guard, option),
      ),
      ...packageCompletions(context.state, guard),
      ...(corpusProvider?.coreCommands() ?? []).map((option) =>
        guardCompletionForSource(guard, option),
      ),
    ]),
  };
}

export function latexCommandCompletions(
  context: CompletionContext,
): CompletionResult | null {
  if (!shouldRunCompletionSource(context, "latex")) return null;
  const source = context.state.doc.toString();
  if (!isLatexCompletionPosition(source, context.pos)) return null;
  const guard = createCompletionRequestGuard(context);
  return (
    structuralArgumentCompletions(context, guard) ??
    commandCompletions(context, guard, false)
  );
}

export function slashCompletions(
  context: CompletionContext
): CompletionResult | null {
  if (!shouldRunCompletionSource(context, "latex")) return null;
  const source = context.state.doc.toString();
  if (!isLatexCompletionPosition(source, context.pos)) return null;
  const guard = createCompletionRequestGuard(context);
  const before = boundedCompletionContext(context.state, context.pos);
  const m = /\/([a-zA-Z]*)$/.exec(before);
  if (!m) return null;
  const slash: Completion[] = [
    { label: "/section", type: "snippet", detail: editorMessage("latex.snippet.section"), apply: snippet("\\section{${1}}") },
    { label: "/subsection", type: "snippet", detail: editorMessage("latex.snippet.subsection"), apply: snippet("\\subsection{${1}}") },
    { label: "/itemize", type: "snippet", detail: editorMessage("latex.snippet.itemize"), apply: snippet("\\begin{itemize}\n  \\item ${1}\n\\end{itemize}") },
    { label: "/enumerate", type: "snippet", detail: editorMessage("latex.snippet.enumerate"), apply: snippet("\\begin{enumerate}\n  \\item ${1}\n\\end{enumerate}") },
    { label: "/equation", type: "snippet", detail: editorMessage("latex.snippet.equation"), apply: snippet("\\begin{equation}\n  ${1}\n\\end{equation}") },
    { label: "/align", type: "snippet", detail: editorMessage("latex.snippet.align"), apply: snippet("\\begin{align}\n  ${1}\n\\end{align}") },
    { label: "/figure", type: "snippet", detail: editorMessage("latex.snippet.figure"), apply: snippet("\\begin{figure}[htbp]\n  \\centering\n  \\includegraphics[width=${1}\\textwidth]{${2}}\n  \\caption{${3}}\n\\end{figure}") },
    { label: "/table", type: "snippet", detail: editorMessage("latex.snippet.table"), apply: snippet("\\begin{table}[htbp]\n  \\centering\n  \\caption{${1}}\n  \\begin{tabular}{${2}}\n  \\end{tabular}\n\\end{table}") },
    { label: "/item", type: "snippet", detail: editorMessage("latex.snippet.item"), apply: snippet("\\item ${1}") },
    { label: "/frac", type: "snippet", detail: editorMessage("latex.snippet.frac"), apply: snippet("\\frac{${1}}{${2}}") },
    { label: "/bold", type: "snippet", detail: editorMessage("latex.snippet.bold"), apply: snippet("\\textbf{${1}}") },
    { label: "/italic", type: "snippet", detail: editorMessage("latex.snippet.italic"), apply: snippet("\\textit{${1}}") },
    { label: "/label", type: "snippet", detail: editorMessage("latex.snippet.label"), apply: snippet("\\label{${1}}") },
    { label: "/usepackage", type: "snippet", detail: editorMessage("latex.snippet.usepackage"), apply: snippet("\\usepackage{${1}}") },
  ];
  return {
    from: context.pos - m[0].length,
    options: slash.map((option) =>
      guardCompletionForSource(guard, option),
    ),
  };
}
