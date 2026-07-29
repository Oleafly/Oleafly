import { stex, stexMath } from "@codemirror/legacy-modes/mode/stex";
import { LanguageSupport, StreamLanguage } from "@codemirror/language";
import { type EditorState } from "@codemirror/state";
import {
  closeCompletion,
  snippet,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import {
  isLatexCompletionPosition,
  latexBalancedGroupEnd,
  maskLatexIgnoredRegions,
} from "./latex-lexical";
import {
  completionRequestIsCurrent,
  createCompletionRequestGuard,
  type CompletionRequestGuard,
} from "./completion-request";
import { validateXparseArgumentSpecification } from "./latex-xparse";

let bibKeysProvider: () => string[] = () => [];
export function setBibKeysProvider(fn: () => string[]) {
  bibKeysProvider = fn;
}

export const latexLanguage = () =>
  new LanguageSupport(StreamLanguage.define(stex));

/** For content that's bare math (no surrounding $...$ or \[...\]), e.g. the equation preview tool. */
export const latexMathLanguage = () =>
  new LanguageSupport(StreamLanguage.define(stexMath));

function labelsInDocument(state: { doc: { toString: () => string } }): string[] {
  return latexCatalog(state).labels;
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

function cmd(label: string, detail: string, template?: string): Completion {
  return {
    label,
    type: "function",
    detail,
    apply: template ? snippet(template) : undefined,
  };
}

const LATEX_COMMANDS: Completion[] = [
  cmd("\\documentclass", "document class", "\\documentclass{${1}}"),
  cmd("\\begin", "begin environment", "\\begin{${1}}\n  ${2}\n\\end{${1}}"),
  cmd("\\end", "end environment", "\\end{${1}}"),
  cmd("\\textbf", "bold text", "\\textbf{${1}}"),
  cmd("\\textit", "italic text", "\\textit{${1}}"),
  cmd("\\emph", "emphasize", "\\emph{${1}}"),
  cmd("\\underline", "underline", "\\underline{${1}}"),
  cmd("\\texttt", "monospace text", "\\texttt{${1}}"),
  cmd("\\textsc", "small caps", "\\textsc{${1}}"),
  cmd("\\textsf", "sans-serif text", "\\textsf{${1}}"),
  cmd("\\textrm", "roman text", "\\textrm{${1}}"),
  cmd("\\textcolor", "colored text", "\\textcolor{${1}}{${2}}"),
  cmd("\\part", "part heading", "\\part{${1}}"),
  cmd("\\chapter", "chapter heading", "\\chapter{${1}}"),
  cmd("\\section", "section", "\\section{${1}}"),
  cmd("\\subsection", "subsection", "\\subsection{${1}}"),
  cmd("\\subsubsection", "subsubsection", "\\subsubsection{${1}}"),
  cmd("\\paragraph", "paragraph heading", "\\paragraph{${1}}"),
  cmd("\\subparagraph", "subparagraph heading", "\\subparagraph{${1}}"),
  cmd("\\item", "list item", "\\item ${1}"),
  cmd("\\label", "label", "\\label{${1}}"),
  cmd("\\ref", "reference", "\\ref{${1}}"),
  cmd("\\eqref", "equation ref", "\\eqref{${1}}"),
  cmd("\\pageref", "page reference", "\\pageref{${1}}"),
  cmd("\\autoref", "automatic reference", "\\autoref{${1}}"),
  cmd("\\cref", "clever reference", "\\cref{${1}}"),
  cmd("\\cite", "citation", "\\cite{${1}}"),
  cmd("\\parencite", "parenthetical citation", "\\parencite{${1}}"),
  cmd("\\textcite", "textual citation", "\\textcite{${1}}"),
  cmd("\\footnote", "footnote", "\\footnote{${1}}"),
  cmd("\\usepackage", "use package", "\\usepackage{${1}}"),
  cmd("\\title", "title", "\\title{${1}}"),
  cmd("\\author", "author", "\\author{${1}}"),
  cmd("\\date", "date", "\\date{${1}}"),
  cmd("\\thanks", "author acknowledgement", "\\thanks{${1}}"),
  cmd("\\maketitle", "render title"),
  cmd("\\tableofcontents", "table of contents"),
  cmd("\\newpage", "page break"),
  cmd("\\clearpage", "flush floats and start page"),
  cmd("\\pagebreak", "request page break"),
  cmd("\\linebreak", "request line break"),
  cmd("\\hspace", "horizontal space", "\\hspace{${1}}"),
  cmd("\\vspace", "vertical space", "\\vspace{${1}}"),
  cmd("\\input", "include file", "\\input{${1}}"),
  cmd("\\include", "include file", "\\include{${1}}"),
  cmd("\\includegraphics", "image", "\\includegraphics[width=${1}\\textwidth]{${2}}"),
  cmd("\\caption", "float caption", "\\caption{${1}}"),
  cmd("\\centering", "center following content"),
  cmd("\\url", "URL", "\\url{${1}}"),
  cmd("\\href", "hyperlink", "\\href{${1}}{${2}}"),
  cmd("\\addbibresource", "bibliography resource", "\\addbibresource{${1}}"),
  cmd("\\bibliography", "bibliography database", "\\bibliography{${1}}"),
  cmd("\\printbibliography", "render bibliography"),
  cmd("\\frac", "fraction", "\\frac{${1}}{${2}}"),
  cmd("\\sqrt", "square root", "\\sqrt{${1}}"),
  cmd("\\overline", "overline", "\\overline{${1}}"),
  cmd("\\vec", "vector accent", "\\vec{${1}}"),
  cmd("\\hat", "hat accent", "\\hat{${1}}"),
  cmd("\\mathrm", "roman math text", "\\mathrm{${1}}"),
  cmd("\\mathbf", "bold math text", "\\mathbf{${1}}"),
  cmd("\\mathcal", "calligraphic math text", "\\mathcal{${1}}"),
  cmd("\\mathbb", "blackboard-bold math text", "\\mathbb{${1}}"),
  cmd("\\operatorname", "math operator name", "\\operatorname{${1}}"),
  cmd("\\sum", "summation"),
  cmd("\\prod", "product"),
  cmd("\\int", "integral"),
  cmd("\\lim", "limit"),
  cmd("\\itemize", "bulleted list", "\\begin{itemize}\n  \\item ${1}\n\\end{itemize}"),
  cmd("\\enumerate", "numbered list", "\\begin{enumerate}\n  \\item ${1}\n\\end{enumerate}"),
  cmd("\\equation", "display math", "\\begin{equation}\n  ${1}\n\\end{equation}"),
  cmd("\\align", "aligned math", "\\begin{align}\n  ${1}\n\\end{align}"),
];

const STANDARD_ENVIRONMENTS = [
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
  return value.trim().replace(/[\\$}]/gu, "\\$&");
}

function argumentDetail(
  required: number,
  optional: number,
  specification?: string,
): string {
  if (specification !== undefined) {
    return `document macro · xparse ${specification || "no arguments"}`;
  }
  const total = required + optional;
  if (total === 0) return "document macro";
  if (optional === 0) {
    return `document macro · ${required} argument${required === 1 ? "" : "s"}`;
  }
  const parts: string[] = [];
  if (optional > 0) {
    parts.push(`${optional} optional`);
  }
  if (required > 0) {
    parts.push(`${required} required`);
  }
  return `document macro · ${parts.join(" + ")} argument${total === 1 ? "" : "s"}`;
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
  if (countGroup && /^[0-9]$/u.test(countGroup.content.trim())) {
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

    if (kind === "+" || kind === "!") continue;
    if (kind === ">") {
      const processor = parsedGroup(specification, cursor);
      cursor = processor?.to ?? cursor;
      continue;
    }

    if (kind === "m" || kind === "b" || kind === "v") {
      template += `{${"${"}${placeholder}}}`;
      placeholder += 1;
      continue;
    }
    if (kind === "o") {
      template += `[${"${"}${placeholder}}]`;
      placeholder += 1;
      continue;
    }
    if (kind === "O") {
      const defaultGroup = parsedGroup(specification, cursor);
      cursor = defaultGroup?.to ?? cursor;
      const value = snippetDefault(defaultGroup?.content ?? "");
      template += `[${"${"}${placeholder}${value ? `:${value}` : ""}}]`;
      placeholder += 1;
      continue;
    }
    if (kind === "s" || kind === "t") {
      if (kind === "t") {
        cursor = xparseDelimiter(specification, cursor).to;
      }
      template += `${"${"}${placeholder}}`;
      placeholder += 1;
      continue;
    }
    if (
      kind === "r" ||
      kind === "R" ||
      kind === "d" ||
      kind === "D"
    ) {
      const left = xparseDelimiter(specification, cursor);
      const right = xparseDelimiter(specification, left.to);
      cursor = right.to;
      if (kind === "R" || kind === "D") {
        cursor = parsedGroup(specification, cursor)?.to ?? cursor;
      }
      template += `${left.value}${"${"}${placeholder}}${right.value}`;
      placeholder += 1;
      continue;
    }
    if (kind === "e" || kind === "E") {
      cursor = parsedGroup(specification, cursor)?.to ?? cursor;
      if (kind === "E") {
        cursor = parsedGroup(specification, cursor)?.to ?? cursor;
      }
      template += `${"${"}${placeholder}}`;
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

  for (const match of catalogText.matchAll(
    /\\(?:newcommand|renewcommand|providecommand|DeclareRobustCommand)\*?/gu,
  )) {
    const definition = classicCommandDefinition(
      catalogText,
      (match.index ?? 0) + match[0].length,
    );
    if (definition) commands.set(definition.label, definition);
  }
  for (const match of catalogText.matchAll(
    /\\(?:New|Renew|Provide|Declare)DocumentCommand\*?/gu,
  )) {
    const definition = xparseCommandDefinition(
      catalogText,
      (match.index ?? 0) + match[0].length,
    );
    if (definition) commands.set(definition.label, definition);
  }
  for (const match of catalogText.matchAll(
    /\\(?:def|gdef|edef|xdef)\s*(\\(?:[A-Za-z@]+|.))((?:\s*#[1-9])*)/gu,
  )) {
    const label = match[1];
    if (!label) continue;
    const bodyStart =
      (match.index ?? 0) + match[0].length;
    if (!parsedGroup(catalogText, bodyStart)) continue;
    const argumentCount = commandArgumentCount(match[2] ?? "");
    let template = label;
    for (let index = 1; index <= argumentCount; index += 1) {
      template += `{${"${"}${index}}}`;
    }
    commands.set(label, {
      label,
      detail: argumentDetail(argumentCount, 0),
      template,
    });
  }

  for (const match of catalogText.matchAll(
    /\\(?:newenvironment|renewenvironment)\*?\s*\{\s*([^{}\s]+)\s*\}/gu,
  )) {
    if (match[1]) environments.add(match[1]);
  }
  for (const match of catalogText.matchAll(
    /\\(?:New|Renew|Provide|Declare)DocumentEnvironment\s*\{\s*([^{}\s]+)\s*\}/gu,
  )) {
    if (match[1]) environments.add(match[1]);
  }
  for (const match of catalogText.matchAll(
    /\\newtheorem\*?\s*\{\s*([^{}\s]+)\s*\}/gu,
  )) {
    if (match[1]) environments.add(match[1]);
  }

  for (const match of catalogText.matchAll(/\\label\s*\{([^}]{1,500})\}/gu)) {
    const label = match[1]?.trim();
    if (label) labels.add(label);
  }
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
      view.dispatch({
        changes: { from, to, insert: label },
        selection: { anchor: from + label.length },
        userEvent: "input.complete",
      });
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
      view.dispatch({
        changes: { from, to, insert },
        selection: { anchor: from + insert.length },
        userEvent: "input.complete",
      });
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
const PACKAGE_COMMANDS: Record<string, Completion[]> = {
  amsmath: [cmd("\\dfrac", "display fraction", "\\dfrac{${1}}{${2}}"), cmd("\\DeclareMathOperator", "math operator", "\\DeclareMathOperator{${1}}{${2}}")],
  amssymb: [cmd("\\mathbb", "blackboard-bold symbol")],
  graphicx: [cmd("\\rotatebox", "rotate graphic", "\\rotatebox{${1}}{${2}}")],
  hyperref: [cmd("\\hypersetup", "hyperlink setup", "\\hypersetup{${1}}")],
  booktabs: [cmd("\\toprule", "table top rule"), cmd("\\midrule", "table mid rule"), cmd("\\bottomrule", "table bottom rule")],
  siunitx: [cmd("\\SI", "quantity", "\\SI{${1}}{${2}}"), cmd("\\num", "number", "\\num{${1}}")],
};

function packageCompletions(
  state: EditorState,
  guard: CompletionRequestGuard,
): Completion[] {
  return latexCatalog(state).packages.flatMap((name) =>
    (PACKAGE_COMMANDS[name] ?? []).map((option) =>
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
    let cursor = commandStart + 1;
    while (/[A-Za-z@]/u.test(prefix[cursor] ?? "")) cursor += 1;
    const command = prefix.slice(commandStart + 1, cursor);
    if (commands.has(command)) {
      if (options.allowStar && prefix[cursor] === "*") cursor += 1;
      cursor = skipWhitespace(prefix, cursor);

      let valid = true;
      for (
        let group = 0;
        group < (options.optionalGroups ?? 0) && prefix[cursor] === "[";
        group += 1
      ) {
        const groupEnd = latexBalancedGroupEnd(prefix, cursor, "[", "]");
        if (groupEnd === null) {
          valid = false;
          break;
        }
        cursor = skipWhitespace(prefix, groupEnd);
      }

      if (valid && prefix[cursor] === "{") {
        const argument = prefix.slice(cursor + 1);
        if (
          argument.length <= 500 &&
          !argument.includes("{") &&
          !argument.includes("}")
        ) {
          return { text: prefix.slice(commandStart) };
        }
      }
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
    const query = currentArgumentQuery(environmentMatch.text);
    const local = latexCatalog(context.state).environments.map((name) =>
      guardedLocalCompletion(
        guard,
        name,
        "type",
        "document environment",
      ),
    );
    return {
      from: context.pos - query.length,
      options: uniqueCompletions([
        ...local,
        ...STANDARD_ENVIRONMENTS.map((name) =>
          guardCompletionForSource(guard, {
            label: name,
            type: "type",
            detail: "standard LaTeX environment",
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
          detail: "LaTeX package",
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
          detail: "LaTeX document class",
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
          detail: "label",
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
          detail: "citation",
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
      ...LATEX_COMMANDS.map((option) =>
        guardCompletionForSource(guard, option),
      ),
      ...packageCompletions(context.state, guard),
    ]),
  };
}

export function latexCommandCompletions(
  context: CompletionContext,
): CompletionResult | null {
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
  const source = context.state.doc.toString();
  if (!isLatexCompletionPosition(source, context.pos)) return null;
  const guard = createCompletionRequestGuard(context);
  const line = context.state.doc.lineAt(context.pos);
  const before = line.text.slice(0, context.pos - line.from);
  const m = before.match(/\/([a-zA-Z]*)$/);
  if (!m) return null;
  const slash: Completion[] = [
    { label: "/section", type: "snippet", detail: "Section", apply: snippet("\\section{${1}}") },
    { label: "/subsection", type: "snippet", detail: "Subsection", apply: snippet("\\subsection{${1}}") },
    { label: "/itemize", type: "snippet", detail: "Bulleted list", apply: snippet("\\begin{itemize}\n  \\item ${1}\n\\end{itemize}") },
    { label: "/enumerate", type: "snippet", detail: "Numbered list", apply: snippet("\\begin{enumerate}\n  \\item ${1}\n\\end{enumerate}") },
    { label: "/equation", type: "snippet", detail: "Display equation", apply: snippet("\\begin{equation}\n  ${1}\n\\end{equation}") },
    { label: "/align", type: "snippet", detail: "Aligned equations", apply: snippet("\\begin{align}\n  ${1}\n\\end{align}") },
    { label: "/figure", type: "snippet", detail: "Figure float", apply: snippet("\\begin{figure}[htbp]\n  \\centering\n  \\includegraphics[width=${1}\\textwidth]{${2}}\n  \\caption{${3}}\n\\end{figure}") },
    { label: "/table", type: "snippet", detail: "Table float", apply: snippet("\\begin{table}[htbp]\n  \\centering\n  \\caption{${1}}\n  \\begin{tabular}{${2}}\n  \\end{tabular}\n\\end{table}") },
    { label: "/item", type: "snippet", detail: "List item", apply: snippet("\\item ${1}") },
    { label: "/frac", type: "snippet", detail: "Fraction", apply: snippet("\\frac{${1}}{${2}}") },
    { label: "/bold", type: "snippet", detail: "Bold", apply: snippet("\\textbf{${1}}") },
    { label: "/italic", type: "snippet", detail: "Italic", apply: snippet("\\textit{${1}}") },
    { label: "/label", type: "snippet", detail: "Label", apply: snippet("\\label{${1}}") },
    { label: "/usepackage", type: "snippet", detail: "Use package", apply: snippet("\\usepackage{${1}}") },
  ];
  return {
    from: context.pos - m[0].length,
    options: slash.map((option) =>
      guardCompletionForSource(guard, option),
    ),
  };
}
