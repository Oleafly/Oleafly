import {
  closeCompletion,
  snippet,
  type Completion,
  type CompletionContext,
  type CompletionResult,
  type CompletionSource,
  insertCompletionText,
} from "@codemirror/autocomplete";
import {
  completionRequestIsCurrent,
  createCompletionRequestGuard,
  environmentSnippet,
  gateCompletionSource,
  getEditorDocumentPath,
  latexReferenceCitationCompletions,
  shouldRunCompletionSource,
  typstBibliographyParameterCompletions,
  typstBibliographyStyleCompletions,
  typstContextAt,
  type CompletionRequestGuard,
} from "@oleafly/editor";
import { forceLinting, linter, type Action, type Diagnostic } from "@codemirror/lint";
import { StateEffect, type EditorState, type Extension } from "@codemirror/state";
import {
  closeHoverTooltips,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import { auxNumberFor } from "@/lib/aux-numbers";
import { basename, dirname } from "@/lib/path-utils";
import {
  atSuggestionCompletion,
  warmAtSuggestions,
} from "./at-suggestions";
import { clearProjectHoverIntel, kindNoun } from "./hover-intel";
import { zoteroCitationSource } from "./zotero-completion";
import {
  fileTargetAccepts,
  keyvalKeysForCommand,
  optionKeysForCatalog,
  recognizeFileTarget,
  recognizeGlossaryKey,
  recognizeImportPath,
  recognizeKeyval,
  recognizePackageOption,
} from "./latex-contexts";
import {
  catalogNamesForSnapshot,
  corpusClassNames,
  corpusCore,
  corpusPackageNames,
  loadedCatalogsFor,
  requestPackageCatalogs,
} from "@/lib/latex-corpus";
import { analyzeProjectFile } from "@/lib/project-intelligence/analyze-file";
import {
  definitionCandidatesForUse,
  definitionsByKey,
} from "@/lib/project-intelligence/resolution";
import { citationCompletions } from "@/lib/project-intelligence/selectors";
import { engineForPath } from "@/lib/project-intelligence/source";
import { currentSourceProjectIntelligence } from "@/lib/project-intelligence/current";
import { navigateToProjectRange } from "@/lib/project-intelligence/navigation";
import { projectDiagnosticText } from "@/lib/project-intelligence/reason";
import type {
  CitationCompletion,
  ProjectDefinition,
  ProjectDiagnostic,
  ProjectIntelligenceSnapshot,
  ProjectIntelligenceState,
  ProjectUse,
} from "@/lib/project-intelligence/types";
import { i18n } from "@/i18n";
import { useFilesStore } from "@/store/files";
import { useIndexStore } from "@/store/project-index";
import { useZoteroLibraryStore, zoteroHasKey } from "@/store/zotero-library";
import {
  addCitedKeyFromZotero,
  missingKeysInZotero,
  openMissingCitations,
  staleEntryFor,
  updateEntryFromZotero,
  useZoteroStaleStore,
} from "@/features/zotero-actions";

const SUPPORTED_SOURCE_RE = /\.(?:tex|latex|ltx|sty|cls|md|markdown|typ|bib)$/i;
// This cap is applied only after the current query has filtered the complete
// project index. Completion results deliberately omit `validFor`, so every
// completion-query edit reruns the source and symbols beyond the initial page
// remain reachable by narrowing.
const FILTERED_COMPLETION_LIMIT = 200;
const STANDARD_LATEX_ENVIRONMENTS = [
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
const STANDARD_LATEX_CLASSES = [
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
const STANDARD_LATEX_PACKAGES = [
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

interface CompletionGuard {
  path: string;
  snapshot: ProjectIntelligenceSnapshot | null;
  request: CompletionRequestGuard;
  retained?: boolean;
}

function completionGuardHolds(
  guard: CompletionGuard,
  state: EditorState,
): boolean {
  if (!completionRequestIsCurrent(guard.request, state)) return false;
  if (guard.retained) return getEditorDocumentPath() === guard.path;
  const current = currentSourceProjectIntelligence(state.doc.toString());
  return current?.path === guard.path && current.snapshot === guard.snapshot;
}

function guardedApply(
  guard: CompletionGuard,
  insert: string,
  asSnippet = false,
  replaceClosingBrace = false,
  linkedInsert: string | null = null,
): NonNullable<Completion["apply"]> {
  return (view, completion, from, to) => {
    if (!completionGuardHolds(guard, view.state)) {
      closeCompletion(view);
      return;
    }
    const targetTo =
      replaceClosingBrace && view.state.sliceDoc(to, to + 1) === "}"
        ? to + 1
        : to;
    if (linkedInsert !== null && view.state.selection.ranges.length > 1) {
      view.dispatch(insertCompletionText(view.state, linkedInsert, from, to));
      return;
    }
    if (asSnippet) {
      snippet(insert)(view, completion, from, targetTo);
      return;
    }
    view.dispatch(insertCompletionText(view.state, insert, from, targetTo));
  };
}

function definitionCompletionType(
  kind: ProjectDefinition["kind"],
): string {
  if (kind === "bibentry") return "constant";
  if (kind === "macro") return "function";
  return "variable";
}

function completionKey(text: string): string {
  return text.normalize("NFC").toLocaleLowerCase();
}

function isNfc(text: string): boolean {
  return text === text.normalize("NFC");
}

// Labels, anchors and headings are only reachable from a document compiled by
// the same engine: a LaTeX \ref cannot see a Typst <label>, nor the reverse.
const ENGINE_SCOPED_KINDS: ReadonlySet<ProjectDefinition["kind"]> = new Set([
  "label",
  "anchor",
  "section",
]);

function definitionOptions(
  snapshot: Pick<ProjectIntelligenceSnapshot, "definitions">,
  guard: CompletionGuard,
  kinds: ReadonlySet<ProjectDefinition["kind"]>,
  query: string,
  includeEnvironmentArguments = false,
): Completion[] {
  const normalizedQuery = completionKey(query);
  const engine = engineForPath(guard.path);
  const candidates = snapshot.definitions.filter(
    (definition) =>
      kinds.has(definition.kind) &&
      (!ENGINE_SCOPED_KINDS.has(definition.kind) ||
        definition.engine === engine) &&
      (!normalizedQuery ||
        completionKey(definition.name).includes(normalizedQuery)),
  );
  const counts = new Map<string, number>();
  for (const candidate of candidates) {
    counts.set(candidate.name, (counts.get(candidate.name) ?? 0) + 1);
  }

  return [...candidates]
    .sort((left, right) => {
      const leftPrefix = completionKey(left.name).startsWith(normalizedQuery);
      const rightPrefix = completionKey(right.name).startsWith(normalizedQuery);
      if (leftPrefix !== rightPrefix) return leftPrefix ? -1 : 1;
      return left.name.localeCompare(right.name) ||
        left.location.file.localeCompare(right.location.file) ||
        left.location.range.from - right.location.range.from;
    })
    .slice(0, FILTERED_COMPLETION_LIMIT)
    .map((definition) => {
      const duplicateCount = counts.get(definition.name) ?? 1;
      const auxNumber =
        definition.kind === "label" || definition.kind === "anchor"
          ? auxNumberFor(definition.name)
          : null;
      const auxDetail = auxNumber ? ` · №${auxNumber.number}` : "";
      const duplicateDetail = `${auxDetail}${
        duplicateCount > 1
          ? ` · ${i18n.t(($) => $.intelligence.completion.duplicateCount, { count: duplicateCount })}`
          : ""
      }`;
      const appendArguments =
        definition.kind === "macro" ||
        (definition.kind === "environment" &&
          includeEnvironmentArguments);
      const argumentsSnippet = appendArguments
        ? definition.latexArguments?.completionSnippet ?? ""
        : "";
      const environmentWithArguments =
        definition.kind === "environment" &&
        includeEnvironmentArguments &&
        argumentsSnippet.length > 0;
      const environmentSkeleton =
        definition.kind === "environment" &&
        includeEnvironmentArguments &&
        argumentsSnippet.length === 0;
      let insertion = `${definition.name}${argumentsSnippet}`;
      if (environmentWithArguments) {
        insertion = `${definition.name}}${argumentsSnippet}`;
      } else if (environmentSkeleton) {
        insertion = environmentSnippet(definition.name);
      }
      return {
        label: definition.name,
        type: definitionCompletionType(definition.kind),
        detail: `${kindNoun(definition.kind)}${duplicateDetail} · ${basename(definition.location.file)}:${definition.location.range.startLine}`,
        info: definition.detail,
        apply: guardedApply(
          guard,
          insertion,
          argumentsSnippet.length > 0 || environmentSkeleton,
          environmentWithArguments || environmentSkeleton,
          environmentSkeleton ? definition.name : null,
        ),
      };
    });
}

function citationOptions(
  snapshot: ProjectIntelligenceSnapshot | null,
  guard: CompletionGuard,
  query: string,
): Completion[] {
  if (!snapshot) return [];
  return citationCompletions(
    snapshot,
    query,
    FILTERED_COMPLETION_LIMIT,
  ).map(
    (candidate: CitationCompletion) => {
      const duplicate = candidate.duplicate
        ? ` · ${i18n.t(($) => $.intelligence.completion.duplicateIndex, {
            index: candidate.duplicateIndex + 1,
            total: candidate.duplicateCount,
          })}`
        : "";
      return {
        label: candidate.label,
        displayLabel: candidate.key,
        type: "constant",
        detail: `${candidate.detail}${duplicate} · ${basename(candidate.location.file)}:${candidate.location.range.startLine}`,
        info: [candidate.author, candidate.title, candidate.year]
          .filter(Boolean)
          .join(" · "),
        apply: guardedApply(guard, candidate.key),
      };
    },
  );
}

/**
 * Shared completion info panel: optional description paragraph, optional
 * muted meta line, optional external link. Returns undefined when empty so
 * callers can spread it conditionally.
 */
export function completionInfoPanel(options: {
  description?: string;
  meta?: string;
  link?: { href: string; label: string };
}): Completion["info"] | undefined {
  const { description, meta, link } = options;
  if (!description && !meta && !link) return undefined;
  return () => {
    const dom = document.createElement("div");
    if (description) {
      const paragraph = document.createElement("p");
      paragraph.textContent = description;
      paragraph.style.margin = "0 0 0.4rem";
      dom.appendChild(paragraph);
    }
    if (meta) {
      const line = document.createElement("p");
      line.textContent = meta;
      line.style.margin = "0 0 0.4rem";
      line.style.opacity = "0.75";
      dom.appendChild(line);
    }
    if (link) {
      const anchor = document.createElement("a");
      anchor.href = link.href;
      anchor.target = "_blank";
      anchor.rel = "noreferrer";
      anchor.textContent = link.label;
      anchor.style.textDecoration = "underline";
      anchor.style.textUnderlineOffset = "2px";
      dom.appendChild(anchor);
    }
    return dom;
  };
}

function corpusNameInfo(
  name: string,
  description: string | undefined,
): Completion["info"] {
  return completionInfoPanel({
    description,
    link: {
      href: `https://ctan.org/pkg/${name}`,
      label: `ctan.org/pkg/${name}`,
    },
  });
}

function completionResult(
  from: number,
  options: Completion[],
  query = "",
): CompletionResult | null {
  if (options.length === 0) return null;
  return {
    from,
    options,
    filter: isNfc(query) && options.every((option) => isNfc(option.label)),
  };
}

const CITATION_ARGUMENT_RE =
  /\\([A-Za-z]+)\*?(?:\[[^\]]*\])*\{(?:[^{}]*,)?([^,{}]*)$/u;

const REFERENCE_ARGUMENT_RE =
  /\\([A-Za-z]+)\*?\s*\{(?:[^{}]*,)?([^,{}]*)$/u;

const REFERENCE_COMMANDS: ReadonlySet<string> = new Set([
  "ref",
  "eqref",
  "pageref",
  "autoref",
  "cref",
  "Cref",
  "cpageref",
  "vref",
  "Vref",
  "labelcref",
  "nameref",
  "namecref",
  "fref",
  "sref",
  "labelref",
]);

interface LatexCompletionArgs {
  context: CompletionContext;
  snapshot: ProjectIntelligenceSnapshot;
  guard: CompletionGuard;
  before: string;
}

type LatexCompletionOutcome = CompletionResult | null | undefined;

function environmentCompletion(
  args: LatexCompletionArgs,
): LatexCompletionOutcome {
  const { context, snapshot, guard, before } = args;
  const environment =
    /\\(begin|end)\s*\{([^{}]*)$/u.exec(before);
  if (environment) {
    const query = environment[2] ?? "";
    const project = definitionOptions(
      snapshot,
      guard,
      new Set(["environment"]),
      query,
      environment[1] === "begin",
    );
    const projectNames = new Set(
      project.map((option) => option.label),
    );
    const core = corpusCore();
    const packageEnvironments = [
      ...loadedCatalogsFor(
        catalogNamesForSnapshot(snapshot),
      ).values(),
    ].flatMap((catalog) =>
      catalog.envs
        .filter((env) => !env.unusual)
        .map((env) => env.name),
    );
    const standardNames = core
      ? [
          ...new Set([
            ...packageEnvironments,
            ...core.environments.map((env) => env.name),
          ]),
        ]
      : [...STANDARD_LATEX_ENVIRONMENTS];
    const standard = standardNames
      .filter(
        (name) =>
          !projectNames.has(name) &&
          name.toLocaleLowerCase().includes(
            query.toLocaleLowerCase(),
          ),
      )
      .map((name) => ({
        label: name,
        type: "type",
        detail: i18n.t(($) => $.intelligence.completion.standardEnvironment),
        boost:
          environment[1] === "end" &&
          before.includes(String.raw`\begin{${name}}`)
            ? 50
            : undefined,
        apply:
          environment[1] === "begin"
            ? guardedApply(guard, environmentSnippet(name), true, true, name)
            : guardedApply(guard, name),
      } satisfies Completion));
    return completionResult(
      context.pos - query.length,
      [...project, ...standard].slice(
        0,
        FILTERED_COMPLETION_LIMIT,
      ),
    );
  }

  return undefined;
}

function packageOptionCompletion(
  args: LatexCompletionArgs,
): LatexCompletionOutcome {
  const { context, guard, before } = args;
  const packageOption = recognizePackageOption(
    before,
    context.state.sliceDoc(
      context.pos,
      Math.min(context.state.doc.length, context.pos + 200),
    ),
  );
  if (packageOption) {
    const catalogName =
      packageOption.kind === "class"
        ? `class-${packageOption.name}`
        : packageOption.name;
    requestPackageCatalogs([catalogName]);
    const options = [
      ...loadedCatalogsFor([catalogName]).values(),
    ].flatMap((catalog) =>
      optionKeysForCatalog(
        catalog,
        packageOption.kind,
        packageOption.name,
      ),
    );
    const query = packageOption.query;
    const filtered = options
      .filter((option) =>
        option
          .toLocaleLowerCase()
          .includes(query.toLocaleLowerCase()),
      )
      .slice(0, FILTERED_COMPLETION_LIMIT)
      .map((option) => ({
        label: option,
        type: "property",
        detail: i18n.t(($) => $.intelligence.completion.packageOption, {
          name: packageOption.name,
        }),
        apply: guardedApply(guard, option),
      } satisfies Completion));
    if (filtered.length) {
      return completionResult(
        context.pos - query.length,
        filtered,
      );
    }
  }

  return undefined;
}

function packageNameCompletion(
  args: LatexCompletionArgs,
): LatexCompletionOutcome {
  const { context, guard, before } = args;
  const packageName =
    /\\usepackage\s*(?:\[[^\]]*\])?\{(?:[^{}]*,)?([^,{}]*)$/u.exec(
      before,
    );
  if (packageName) {
    const query = (packageName[1] ?? "").trimStart();
    const names = corpusPackageNames();
    return completionResult(
      context.pos - query.length,
      (names ? names.names : STANDARD_LATEX_PACKAGES)
        .filter((name) =>
          name
            .toLocaleLowerCase()
            .includes(query.toLocaleLowerCase()),
        )
        .slice(0, FILTERED_COMPLETION_LIMIT)
        .map((name) => ({
          label: name,
          type: "namespace",
          detail: names?.details[name] ?? i18n.t(($) => $.intelligence.completion.latexPackage),
          ...(names
            ? { info: corpusNameInfo(name, names.details[name]) }
            : {}),
          apply: guardedApply(guard, name),
        })),
    );
  }

  return undefined;
}

function documentClassCompletion(
  args: LatexCompletionArgs,
): LatexCompletionOutcome {
  const { context, guard, before } = args;
  const documentClass =
    /\\documentclass\s*(?:\[[^\]]*\])?\{([^{}]*)$/u.exec(before);
  if (documentClass) {
    const query = documentClass[1] ?? "";
    const names = corpusClassNames();
    return completionResult(
      context.pos - query.length,
      (names ? names.names : STANDARD_LATEX_CLASSES)
        .filter((name) =>
          name
            .toLocaleLowerCase()
            .includes(query.toLocaleLowerCase()),
        )
        .slice(0, FILTERED_COMPLETION_LIMIT)
        .map((name) => ({
          label: name,
          type: "type",
          detail:
            names?.details[name] ?? i18n.t(($) => $.intelligence.completion.latexDocumentClass),
          ...(names
            ? { info: corpusNameInfo(name, names.details[name]) }
            : {}),
          apply: guardedApply(guard, name),
        })),
    );
  }

  return undefined;
}

function importPathCompletion(
  args: LatexCompletionArgs,
): LatexCompletionOutcome {
  const { context, snapshot, guard, before } = args;
  const importPath = recognizeImportPath(before);
  if (importPath) {
    const query = importPath.query;
    const prefix = importPath.directory
      ? `${importPath.directory}/`
      : "";
    return completionResult(
      context.pos - query.length,
      definitionOptions(
        snapshot,
        guard,
        new Set(["file"]),
        `${prefix}${query}`,
      ).filter((option) =>
        fileTargetAccepts("input", String(option.label)),
      ),
      query,
    );
  }

  return undefined;
}

function fileTargetCompletion(
  args: LatexCompletionArgs,
): LatexCompletionOutcome {
  const { context, snapshot, guard, before } = args;
  const fileTarget = recognizeFileTarget(before);
  if (fileTarget) {
    const query = fileTarget.query;
    return completionResult(
      context.pos - query.length,
      definitionOptions(
        snapshot,
        guard,
        new Set(["file"]),
        query,
      ).filter((option) =>
        fileTargetAccepts(fileTarget.command, String(option.label)),
      ),
      query,
    );
  }

  return undefined;
}

function citationCompletion(
  args: LatexCompletionArgs,
): LatexCompletionOutcome {
  const { context, snapshot, guard, before } = args;
  const citation = CITATION_ARGUMENT_RE.exec(before);
  if (citation?.[1].includes("cite")) {
    const query = (citation[2] ?? "").trimStart();
    return completionResult(
      context.pos - query.length,
      citationOptions(snapshot, guard, query),
      query,
    );
  }

  return undefined;
}

function referenceCompletion(
  args: LatexCompletionArgs,
): LatexCompletionOutcome {
  const { context, snapshot, guard, before } = args;
  const reference = REFERENCE_ARGUMENT_RE.exec(before);
  if (reference && REFERENCE_COMMANDS.has(reference[1])) {
    const query = (reference[2] ?? "").trimStart();
    return completionResult(
      context.pos - query.length,
      definitionOptions(
        snapshot,
        guard,
        new Set(["label", "anchor"]),
        query,
      ),
      query,
    );
  }

  return undefined;
}

function glossaryCompletion(
  args: LatexCompletionArgs,
): LatexCompletionOutcome {
  const { context, snapshot, guard, before } = args;
  const glossaryKey = recognizeGlossaryKey(before);
  if (glossaryKey) {
    return completionResult(
      context.pos - glossaryKey.query.length,
      definitionOptions(
        snapshot,
        guard,
        new Set(["glossary"]),
        glossaryKey.query,
      ),
      glossaryKey.query,
    );
  }

  return undefined;
}

function keyvalCompletion(
  args: LatexCompletionArgs,
): LatexCompletionOutcome {
  const { context, snapshot, guard, before } = args;
  const keyval = recognizeKeyval(before);
  if (keyval) {
    const keys = keyvalKeysForCommand(
      [
        ...loadedCatalogsFor(
          catalogNamesForSnapshot(snapshot),
        ).values(),
      ],
      keyval.command,
    ).filter((key) =>
      key
        .toLocaleLowerCase()
        .includes(keyval.query.toLocaleLowerCase()),
    );
    if (keys.length) {
      return completionResult(
        context.pos - keyval.query.length,
        keys.slice(0, FILTERED_COMPLETION_LIMIT).map((key) => ({
          label: key,
          type: "property",
          detail: i18n.t(($) => $.intelligence.completion.keyvalKey, {
            command: keyval.command,
          }),
          apply: guardedApply(guard, key),
        } satisfies Completion)),
      );
    }
  }

  return undefined;
}

function commandCompletion(
  args: LatexCompletionArgs,
): LatexCompletionOutcome {
  const { context, snapshot, guard, before } = args;
  const command = /\\([A-Za-z@]*)$/u.exec(before);
  if (command) {
    const query = command[1] ?? "";
    const project = definitionOptions(
      snapshot,
      guard,
      new Set(["macro"]),
      query,
    );
    const projectNames = new Set(
      project.map((option) => option.label),
    );
    const queryLower = query.toLocaleLowerCase();
    const seenMacros = new Set<string>();
    const packageMacros = [
      ...loadedCatalogsFor(
        catalogNamesForSnapshot(snapshot),
      ).entries(),
    ].flatMap(([catalogName, catalog]) =>
      catalog.macros
        .filter((macro) => {
          if (
            macro.unusual ||
            projectNames.has(macro.name) ||
            seenMacros.has(macro.name) ||
            !macro.name.toLocaleLowerCase().includes(queryLower)
          ) {
            return false;
          }
          seenMacros.add(macro.name);
          return true;
        })
        .map((macro) => {
          const packageName = catalogName.replace(/^class-/, "");
          const info = completionInfoPanel({
            description: macro.documentation,
            meta: `from ${packageName}`,
            link: {
              href: `https://ctan.org/pkg/${packageName}`,
              label: `ctan.org/pkg/${packageName}`,
            },
          });
          return {
            label: macro.name,
            type: "function",
            detail: macro.detail ?? i18n.t(($) => $.intelligence.completion.packageCommand),
            ...(info ? { info } : {}),
            apply: guardedApply(
              guard,
              macro.snippet ?? macro.name,
              macro.snippet !== undefined,
            ),
          } satisfies Completion;
        }),
    );
    return completionResult(
      context.pos - query.length,
      [...project, ...packageMacros].slice(
        0,
        FILTERED_COMPLETION_LIMIT,
      ),
    );
  }
  return undefined;
}

const LATEX_COMPLETION_STEPS: readonly ((
  args: LatexCompletionArgs,
) => LatexCompletionOutcome)[] = [
  environmentCompletion,
  packageOptionCompletion,
  packageNameCompletion,
  documentClassCompletion,
  importPathCompletion,
  fileTargetCompletion,
  citationCompletion,
  referenceCompletion,
  glossaryCompletion,
  keyvalCompletion,
  commandCompletion,
];

function latexCompletion(
  context: CompletionContext,
  snapshot: ProjectIntelligenceSnapshot,
  guard: CompletionGuard,
  before: string,
): CompletionResult | null {
  const args = { context, snapshot, guard, before };
  for (const step of LATEX_COMPLETION_STEPS) {
    const result = step(args);
    if (result !== undefined) return result;
  }
  return null;
}

function markdownCompletion(
  context: CompletionContext,
  snapshot: ProjectIntelligenceSnapshot,
  guard: CompletionGuard,
  before: string,
): CompletionResult | null {
  const anchor = /\]\(#([\p{L}\p{M}\p{N}_:.+/-]*)$/u.exec(before);
  if (anchor) {
    const query = anchor[1] ?? "";
    return completionResult(
      context.pos - query.length,
      definitionOptions(
        snapshot,
        guard,
        new Set(["label", "anchor", "section"]),
        query,
      ),
      query,
    );
  }

  const at = /(?:^|[[(\s;,])@([\p{L}\p{M}\p{N}_:.+/-]*)$/u.exec(before);
  if (!at || before.endsWith(String.raw`\@`)) return null;
  const query = at[1] ?? "";
  const definitions = definitionOptions(
    snapshot,
    guard,
    new Set(["label", "anchor", "section"]),
    query,
  );
  return completionResult(
    context.pos - query.length,
    [...citationOptions(snapshot, guard, query), ...definitions].slice(
      0,
      FILTERED_COMPLETION_LIMIT,
    ),
    query,
  );
}

const TYPST_SOURCE_RE = /\.typ$/i;

const TYPST_LABEL_KINDS: ReadonlySet<ProjectDefinition["kind"]> = new Set([
  "label",
]);

const TYPST_PATH_CALL_RE = /(?<![\p{L}\p{N}_.-])([a-z]+)\s*\(\s*"([^"\n]*)$/u;

const TYPST_PATH_ARRAY_RE =
  /(?<![\p{L}\p{N}_.-])([a-z]+)\s*\(\s*\(\s*(?:"[^"\n]*"\s*,\s*)*"([^"\n]*)$/u;

const TYPST_MODULE_PATH_RE = /(?<![\p{L}\p{N}_.-])(include|import)\s+"([^"\n]*)$/u;

const TYPST_PATH_CALLS: ReadonlySet<string> = new Set([
  "image",
  "read",
  "csv",
  "json",
  "yaml",
  "toml",
  "xml",
  "cbor",
  "plugin",
  "bibliography",
]);

const TYPST_PATH_EXTENSIONS: ReadonlyMap<string, RegExp | null> = new Map([
  ["image", /\.(?:png|jpe?g|gif|svg|webp|pdf)$/iu],
  ["include", /\.typ$/iu],
  ["import", /\.typ$/iu],
  ["read", null],
  ["csv", /\.(?:csv|tsv)$/iu],
  ["json", /\.json$/iu],
  ["yaml", /\.ya?ml$/iu],
  ["toml", /\.toml$/iu],
  ["xml", /\.xml$/iu],
  ["cbor", /\.cbor$/iu],
  ["bibliography", /\.(?:bib|ya?ml)$/iu],
  ["plugin", /\.wasm$/iu],
]);

const TYPST_CITATION_RE =
  /#cite\s*\([\s\S]{0,500}(?:<|label\s*\(\s*"|")([\p{L}\p{M}\p{N}_:.+/-]*)$/u;

const TYPST_REFERENCE_RE =
  /(?:#|(?<![\p{L}\p{N}_.-]))(?:ref|link)\s*\(\s*<([\p{L}\p{M}\p{N}_:.+/-]*)$/u;

const TYPST_AT_RE = /(?:^|[\s[(;,])@([\p{L}\p{M}\p{N}_:.+/-]*)$/u;

const TYPST_HASH_IDENTIFIER_RE = /#([\p{L}_][\p{L}\p{M}\p{N}_-]*)$/u;

const TYPST_CODE_IDENTIFIER_RE =
  /(?<![\p{L}\p{M}\p{N}_-])([\p{L}_][\p{L}\p{M}\p{N}_-]*)?$/u;

const TYPST_POSITIONAL_PARAMETER = /^[\p{L}_][\p{L}\p{M}\p{N}_-]*$/u;

const TYPST_KEYWORDS: ReadonlySet<string> = new Set([
  "let",
  "set",
  "show",
  "import",
  "include",
  "if",
  "else",
  "for",
  "while",
  "return",
  "context",
  "break",
  "continue",
]);

const TYPST_PARAMETER_SCAN_LIMIT = 2_000;

interface TypstCompletionModel {
  readonly guard: CompletionGuard;
  readonly definitions: Pick<ProjectIntelligenceSnapshot, "definitions">;
  readonly bibliography: ProjectIntelligenceSnapshot | null;
  readonly textFor: (file: string) => string | undefined;
}

function relativeProjectPath(fromFile: string, target: string): string {
  const base = dirname(fromFile).split("/").filter(Boolean);
  const parts = target.split("/");
  let shared = 0;
  while (
    shared < base.length &&
    shared < parts.length - 1 &&
    base[shared] === parts[shared]
  ) {
    shared += 1;
  }
  return [...base.slice(shared).map(() => ".."), ...parts.slice(shared)].join("/");
}

function hiddenProjectPath(path: string): boolean {
  return path.split("/").some((segment) => segment.startsWith("."));
}

function prefixFirst(query: string): (left: string, right: string) => number {
  return (left, right) => {
    const leftPrefix = completionKey(left).startsWith(query);
    const rightPrefix = completionKey(right).startsWith(query);
    if (leftPrefix !== rightPrefix) return leftPrefix ? -1 : 1;
    return left.localeCompare(right);
  };
}

function requestGuardedApply(
  request: CompletionRequestGuard,
  insert: string,
): NonNullable<Completion["apply"]> {
  return (view, _completion, from, to) => {
    if (!completionRequestIsCurrent(request, view.state)) {
      closeCompletion(view);
      return;
    }
    view.dispatch(insertCompletionText(view.state, insert, from, to));
  };
}

function typstPathArgument(
  before: string,
): { command: string; query: string } | null {
  const call =
    TYPST_PATH_CALL_RE.exec(before) ?? TYPST_PATH_ARRAY_RE.exec(before);
  if (call) {
    return TYPST_PATH_CALLS.has(call[1])
      ? { command: call[1], query: call[2] }
      : null;
  }
  const module = TYPST_MODULE_PATH_RE.exec(before);
  return module ? { command: module[1], query: module[2] } : null;
}

function typstPathCompletion(
  context: CompletionContext,
  path: string,
  before: string,
  request: CompletionRequestGuard,
): LatexCompletionOutcome {
  const argument = typstPathArgument(before);
  if (!argument) return undefined;
  if (typstContextAt(context.state, context.pos) !== "string") return undefined;
  const { command, query } = argument;
  if (command === "import" && query.startsWith("@")) return null;
  const accepts = TYPST_PATH_EXTENSIONS.get(command) ?? null;
  const rooted = query.startsWith("/");
  const queryKey = completionKey(query);
  const options = useFilesStore
    .getState()
    .tree.filter(
      (entry) =>
        !entry.is_dir &&
        !entry.placeholder &&
        entry.path !== path &&
        !hiddenProjectPath(entry.path) &&
        (!accepts || accepts.test(entry.path)),
    )
    .map((entry) =>
      rooted ? `/${entry.path}` : relativeProjectPath(path, entry.path),
    )
    .filter((label) => !queryKey || completionKey(label).includes(queryKey))
    .sort(prefixFirst(queryKey))
    .slice(0, FILTERED_COMPLETION_LIMIT)
    .map((label) => ({
      label,
      type: "variable",
      detail: kindNoun("file"),
      apply: requestGuardedApply(request, label),
    } satisfies Completion));
  return completionResult(context.pos - query.length, options, query);
}

function closingQuoteIndex(text: string, from: number, limit: number): number {
  for (let index = from + 1; index < limit; index += 1) {
    if (text[index] === "\\") index += 1;
    else if (text[index] === '"') return index;
  }
  return limit;
}

function typstBindingParameters(text: string, nameEnd: number): string | null {
  if (text[nameEnd] !== "(") return null;
  const limit = Math.min(text.length, nameEnd + TYPST_PARAMETER_SCAN_LIMIT);
  let depth = 0;
  let index = nameEnd;
  while (index < limit) {
    const character = text[index];
    if (character === '"') {
      index = closingQuoteIndex(text, index, limit);
    } else if (character === "(" || character === "[" || character === "{") {
      depth += 1;
    } else if (character === ")" || character === "]" || character === "}") {
      depth -= 1;
      if (depth === 0) {
        const parameters = text
          .slice(nameEnd + 1, index)
          .replaceAll(/\s+/gu, " ")
          .trim();
        return parameters.endsWith(",")
          ? parameters.slice(0, -1).trimEnd()
          : parameters;
      }
    }
    index += 1;
  }
  return null;
}

function topLevelParameters(parameters: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  let index = 0;
  while (index < parameters.length) {
    const character = parameters[index];
    if (character === '"') {
      index = closingQuoteIndex(parameters, index, parameters.length);
    } else if (character === "(" || character === "[" || character === "{") {
      depth += 1;
    } else if (character === ")" || character === "]" || character === "}") {
      depth -= 1;
    } else if (character === "," && depth === 0) {
      parts.push(parameters.slice(start, index));
      start = index + 1;
    }
    index += 1;
  }
  parts.push(parameters.slice(start));
  return parts.map((part) => part.trim()).filter(Boolean);
}

function typstCallSnippet(name: string, parameters: string): string {
  const positional = topLevelParameters(parameters).filter((parameter) =>
    TYPST_POSITIONAL_PARAMETER.test(parameter),
  );
  const fields =
    positional.length > 0
      ? positional.map((parameter, index) => `\${${index + 1}:${parameter}}`).join(", ")
      : `\${1}`;
  return `${name}(${fields})`;
}

function typstBindingOptions(
  model: TypstCompletionModel,
  query: string,
  nextCharacter: string,
): Completion[] {
  const key = completionKey(query);
  const order = prefixFirst(key);
  const candidates = model.definitions.definitions
    .filter(
      (definition) =>
        definition.kind === "macro" &&
        definition.engine === "typst" &&
        (!key || completionKey(definition.name).includes(key)),
    )
    .sort(
      (left, right) =>
        Number(right.location.file === model.guard.path) -
          Number(left.location.file === model.guard.path) ||
        order(left.name, right.name) ||
        left.location.file.localeCompare(right.location.file) ||
        left.location.range.from - right.location.range.from,
    );
  const seen = new Set<string>();
  const options: Completion[] = [];
  for (const definition of candidates) {
    if (options.length >= FILTERED_COMPLETION_LIMIT) break;
    if (seen.has(definition.name)) continue;
    seen.add(definition.name);
    const text = model.textFor(definition.location.file);
    const parameters =
      text === undefined
        ? null
        : typstBindingParameters(text, definition.location.range.to);
    const callable =
      parameters !== null && nextCharacter !== "(" && nextCharacter !== "[";
    const where = `${basename(definition.location.file)}:${definition.location.range.startLine}`;
    options.push({
      label: definition.name,
      type: parameters === null ? "variable" : "function",
      detail:
        parameters === null
          ? `${i18n.t(($) => $.intelligence.completion.typstBinding)} · ${where}`
          : `(${parameters}) · ${where}`,
      apply: guardedApply(
        model.guard,
        callable ? typstCallSnippet(definition.name, parameters) : definition.name,
        callable,
      ),
    });
  }
  options.sort(
    (left, right) =>
      order(String(left.label), String(right.label)),
  );
  return options;
}

function typstBindingCompletion(
  context: CompletionContext,
  model: TypstCompletionModel,
  before: string,
): CompletionResult | null {
  const hash = TYPST_HASH_IDENTIFIER_RE.exec(before);
  let query: string | null = null;
  if (hash && !TYPST_KEYWORDS.has(hash[1])) {
    query = hash[1];
  } else if (
    context.explicit &&
    typstContextAt(context.state, context.pos) === "code"
  ) {
    query = TYPST_CODE_IDENTIFIER_RE.exec(before)?.[1] ?? "";
  }
  if (query === null) return null;
  return completionResult(
    context.pos - query.length,
    typstBindingOptions(
      model,
      query,
      context.state.sliceDoc(context.pos, context.pos + 1),
    ),
    query,
  );
}

function typstCompletion(
  context: CompletionContext,
  model: TypstCompletionModel,
  before: string,
): CompletionResult | null {
  const explicitCitation = TYPST_CITATION_RE.exec(before);
  if (explicitCitation) {
    const query = explicitCitation[1] ?? "";
    return completionResult(
      context.pos - query.length,
      citationOptions(model.bibliography, model.guard, query),
      query,
    );
  }

  const explicitReference = TYPST_REFERENCE_RE.exec(before);
  if (explicitReference) {
    const query = explicitReference[1] ?? "";
    return completionResult(
      context.pos - query.length,
      definitionOptions(model.definitions, model.guard, TYPST_LABEL_KINDS, query),
      query,
    );
  }

  const at = TYPST_AT_RE.exec(before);
  if (at) {
    const query = at[1] ?? "";
    return completionResult(
      context.pos - query.length,
      [
        ...citationOptions(model.bibliography, model.guard, query),
        ...definitionOptions(model.definitions, model.guard, TYPST_LABEL_KINDS, query),
      ].slice(0, FILTERED_COMPLETION_LIMIT),
      query,
    );
  }

  return typstBindingCompletion(context, model, before);
}

function typstTextFor(
  path: string,
  text: string,
): (file: string) => string | undefined {
  return (file) =>
    file === path
      ? text
      : (useIndexStore.getState().texts[file] ??
        useFilesStore.getState().files[file]?.content);
}

let currentTypstDefinitions: {
  readonly path: string;
  readonly text: string;
  readonly definitions: readonly ProjectDefinition[];
} | null = null;

function currentFileDefinitions(
  path: string,
  text: string,
): readonly ProjectDefinition[] {
  if (
    text.length > CURRENT_FILE_FALLBACK_MAX_CHARACTERS ||
    exceedsFallbackSyntaxBudget(text)
  ) {
    return [];
  }
  if (currentTypstDefinitions?.path === path && currentTypstDefinitions.text === text) {
    return currentTypstDefinitions.definitions;
  }
  let definitions: readonly ProjectDefinition[];
  try {
    definitions = analyzeProjectFile(path, text, 0).definitions;
  } catch {
    definitions = [];
  }
  currentTypstDefinitions = { path, text, definitions };
  return definitions;
}

function retainedTypstModel(
  path: string,
  text: string,
  request: CompletionRequestGuard,
): TypstCompletionModel | null {
  const files = useFilesStore.getState();
  if (!files.projectId || getEditorDocumentPath() !== path) return null;
  const data = useIndexStore.getState().intelligenceState.data;
  const retained = data?.identity.projectId === files.projectId ? data : null;
  return {
    guard: { path, snapshot: retained, request, retained: true },
    definitions: {
      definitions: [
        ...currentFileDefinitions(path, text),
        ...(retained?.definitions.filter(
          (definition) => definition.location.file !== path,
        ) ?? []),
      ],
    },
    bibliography: retained,
    textFor: typstTextFor(path, text),
  };
}

function typstProjectCompletion(
  context: CompletionContext,
  path: string,
  current: { path: string; snapshot: ProjectIntelligenceSnapshot } | null,
  text: string,
): CompletionResult | null {
  const where = typstContextAt(context.state, context.pos);
  if (where === "comment" || where === "raw") return null;
  const before = context.state.sliceDoc(
    Math.max(0, context.pos - 1_000),
    context.pos,
  );
  const request = createCompletionRequestGuard(context);
  const paths = typstPathCompletion(context, path, before, request);
  if (paths !== undefined) return paths;
  const model: TypstCompletionModel | null = current
    ? {
        guard: { path: current.path, snapshot: current.snapshot, request },
        definitions: current.snapshot,
        bibliography: current.snapshot,
        textFor: typstTextFor(current.path, text),
      }
    : retainedTypstModel(path, text, request);
  return model ? typstCompletion(context, model, before) : null;
}

function bibtexCompletion(
  context: CompletionContext,
  snapshot: ProjectIntelligenceSnapshot,
  guard: CompletionGuard,
  before: string,
): CompletionResult | null {
  const crossReference = /(?:crossref|xref|xdata|related|entryset)\s*=\s*["{]\s*([\p{L}\p{M}\p{N}_:.+/-]*)$/iu.exec(
    before,
  );
  if (!crossReference) return null;
  const query = crossReference[1] ?? "";
  return completionResult(
    context.pos - query.length,
    citationOptions(snapshot, guard, query),
    query,
  );
}

export const projectIntelligenceCompletion: CompletionSource = (
  context,
): CompletionResult | null => {
  const text = context.state.doc.toString();
  const current = currentSourceProjectIntelligence(text);
  const path = current?.path ?? useFilesStore.getState().activePath;
  if (!path || !SUPPORTED_SOURCE_RE.test(path)) return null;
  if (TYPST_SOURCE_RE.test(path)) {
    return typstProjectCompletion(context, path, current, text);
  }
  if (!current) {
    return /\.(?:tex|latex|ltx|sty|cls)$/i.test(path)
      ? latexReferenceCitationCompletions(context)
      : null;
  }

  const guard: CompletionGuard = {
    path: current.path,
    snapshot: current.snapshot,
    request: createCompletionRequestGuard(context),
  };
  const before = context.state.sliceDoc(
    Math.max(0, context.pos - 1_000),
    context.pos,
  );
  const normalizedPath = current.path.toLocaleLowerCase();
  if (/\.(?:tex|latex|ltx|sty|cls)$/.test(normalizedPath)) {
    return latexCompletion(context, current.snapshot, guard, before);
  }
  if (/\.(?:md|markdown)$/.test(normalizedPath)) {
    return markdownCompletion(context, current.snapshot, guard, before);
  }
  if (normalizedPath.endsWith(".bib")) {
    return bibtexCompletion(context, current.snapshot, guard, before);
  }
  return null;
};

function zoteroCitationActions(
  diagnostic: ProjectDiagnostic,
  missingCount: () => number,
): Action[] {
  if (diagnostic.code !== "unresolved-citation") return [];
  const name = diagnostic.message.params?.name;
  if (typeof name !== "string" || !zoteroHasKey(name)) return [];
  const actions: Action[] = [
    {
      name: i18n.t(($) => $.references.zotero.actions.addFromZotero),
      apply: () => {
        void addCitedKeyFromZotero(name);
      },
    },
  ];
  const count = missingCount();
  if (count > 1) {
    actions.push({
      name: i18n.t(($) => $.references.zotero.actions.addAllMissing, { count }),
      apply: openMissingCitations,
    });
  }
  return actions;
}

function staleBibliographyDiagnostics(
  snapshot: ProjectIntelligenceSnapshot,
  path: string,
  length: number,
): Diagnostic[] {
  if (!/\.bib$/i.test(path)) return [];
  const diagnostics: Diagnostic[] = [];
  for (const entry of snapshot.bibliography.entries) {
    if (entry.file !== path) continue;
    const stale = staleEntryFor(path, entry.key);
    if (!stale) continue;
    const from = Math.min(Math.max(0, entry.keyRange.from), length);
    diagnostics.push({
      from,
      to: Math.min(Math.max(from, entry.keyRange.to), length),
      severity: "info",
      message: stale.handEdited
        ? i18n.t(($) => $.references.zotero.actions.changedEdited)
        : i18n.t(($) => $.references.zotero.actions.changed),
      source: "zotero",
      actions: [
        {
          name: i18n.t(($) => $.references.zotero.actions.update),
          apply: () => {
            void updateEntryFromZotero(entry.key);
          },
        },
      ],
    });
  }
  return diagnostics;
}

function relatedActions(
  related: ProjectIntelligenceSnapshot["diagnostics"][number]["related"],
): Action[] {
  return related.slice(0, 3).map((item) => ({
    name: projectDiagnosticText(item.message),
    apply: () => {
      void navigateToProjectRange({
        path: item.location.file,
        range: item.location.range,
        source: "diagnostic",
      });
    },
  }));
}

const refreshProjectIntelligence = StateEffect.define<number>();

function needsProjectRefresh(update: ViewUpdate): boolean {
  return update.transactions.some((transaction) =>
    transaction.effects.some((effect) =>
      effect.is(refreshProjectIntelligence),
    ),
  );
}

function diagnosticIdentity(state: ProjectIntelligenceState): string {
  const identity = state.identity;
  return [
    state.status,
    state.stale ? "stale" : "fresh",
    identity?.projectId ?? "",
    identity?.projectRevision ?? 0,
    identity?.requestGeneration ?? 0,
  ].join(":");
}

const CURRENT_FILE_FALLBACK_MAX_CHARACTERS = 100_000;
const CURRENT_FILE_FALLBACK_MAX_SYNTAX_MARKERS = 2_000;

function exceedsFallbackSyntaxBudget(text: string): boolean {
  let markers = 0;
  for (const character of text) {
    if (
      character !== "\\" &&
      character !== "@" &&
      character !== "#" &&
      character !== "["
    ) {
      continue;
    }
    markers++;
    if (markers > CURRENT_FILE_FALLBACK_MAX_SYNTAX_MARKERS) {
      return true;
    }
  }
  return false;
}

type DefinitionsByKey = ReadonlyMap<string, readonly ProjectDefinition[]>;

const fallbackLookupCache = new WeakMap<
  ProjectIntelligenceSnapshot,
  DefinitionsByKey
>();

function fallbackLookup(
  snapshot: ProjectIntelligenceSnapshot,
): DefinitionsByKey {
  const cached = fallbackLookupCache.get(snapshot);
  if (cached) return cached;
  const lookup = definitionsByKey(snapshot.definitions);
  fallbackLookupCache.set(snapshot, lookup);
  return lookup;
}

/**
 * How many definitions `use` would resolve to once the worker catches up:
 * the current file's fresh definitions stand in for the snapshot's stale copy
 * of that file. The keys are the worker's own, so a LaTeX \ref never counts a
 * Typst label and a Markdown anchor link stays inside its file.
 */
function candidateCount(
  use: ProjectUse,
  path: string,
  current: DefinitionsByKey,
  project: DefinitionsByKey,
): number {
  const elsewhere = definitionCandidatesForUse(use, project).filter(
    (definition) => definition.location.file !== path,
  ).length;
  return definitionCandidatesForUse(use, current).length + elsewhere;
}

function referenceNoun(use: ProjectUse): string {
  if (use.syntax === "typst-at") {
    return i18n.t(($) => $.intelligence.diagnostics.typstLabelOrCitation);
  }
  if (use.kind === "citation") {
    return i18n.t(($) => $.intelligence.diagnostics.citation);
  }
  return i18n.t(($) => $.intelligence.diagnostics.reference);
}

function referenceDiagnosticFor(
  use: ProjectUse,
  path: string,
  current: DefinitionsByKey,
  project: DefinitionsByKey,
): Diagnostic | null {
  if (use.kind !== "reference" && use.kind !== "citation") return null;
  const candidates = candidateCount(use, path, current, project);
  if (candidates === 1) return null;
  const noun = referenceNoun(use);
  return {
    from: use.location.range.from,
    to: Math.max(
      use.location.range.from + 1,
      use.location.range.to,
    ),
    severity: "warning",
    message:
      candidates === 0
        ? i18n.t(($) => $.intelligence.diagnostics.unresolved, {
            noun: noun.toLocaleLowerCase("en-US"),
            name: use.name,
          })
        : i18n.t(($) => $.intelligence.diagnostics.ambiguous, {
            noun,
            name: use.name,
            count: candidates,
          }),
    source: "live references · current file",
  };
}

export function currentFileReferenceDiagnostics(
  path: string,
  text: string,
): Diagnostic[] {
  if (
    !SUPPORTED_SOURCE_RE.test(path) ||
    text.length > CURRENT_FILE_FALLBACK_MAX_CHARACTERS ||
    exceedsFallbackSyntaxBudget(text)
  ) {
    return [];
  }
  const files = useFilesStore.getState();
  const indexed = useIndexStore.getState();
  const state = indexed.intelligenceState;
  const snapshot = state.data;
  if (
    !files.projectId ||
    !snapshot ||
    state.status !== "running" ||
    !state.stale ||
    state.currentFileFallbackAllowed !== true ||
    state.identity?.projectId !== files.projectId ||
    snapshot.identity.projectId !== files.projectId ||
    !snapshot.fileStates[path] ||
    indexed.texts[path] === undefined
  ) {
    return [];
  }

  let currentFile: ReturnType<typeof analyzeProjectFile>;
  try {
    currentFile = analyzeProjectFile(
      path,
      text,
      snapshot.fileStates[path].sourceRevision + 1,
    );
  } catch {
    // The authoritative worker owns error presentation. A fallback parser
    // failure must never turn into guessed or unmasked findings.
    return [];
  }
  const project = fallbackLookup(snapshot);
  const current = definitionsByKey(currentFile.definitions);
  const diagnostics: Diagnostic[] = [];
  for (const use of currentFile.uses) {
    const diagnostic = referenceDiagnosticFor(
      use,
      path,
      current,
      project,
    );
    if (diagnostic) diagnostics.push(diagnostic);
  }
  return diagnostics;
}

function ownedByBibtexLinter(
  path: string,
  code: ProjectDiagnostic["code"],
): boolean {
  return code === "bibtex-validation" && /\.bib$/i.test(path);
}

export function projectIntelligenceExtensions(): Extension[] {
  const diagnostics = linter(
    (view): Diagnostic[] => {
      const current = currentSourceProjectIntelligence(
        view.state.doc.toString(),
      );
      if (!current) {
        const path = useFilesStore.getState().activePath;
        return path
          ? currentFileReferenceDiagnostics(
              path,
              view.state.doc.toString(),
            )
          : [];
      }
      const partial = current.snapshot.status === "partial";
      const length = view.state.doc.length;
      let missing: number | null = null;
      const missingCount = () => {
        missing ??= missingKeysInZotero().length;
        return missing;
      };
      return current.snapshot.diagnostics
        .filter(
          (diagnostic) =>
            diagnostic.location.file === current.path &&
            !ownedByBibtexLinter(current.path, diagnostic.code),
        )
        .map((diagnostic): Diagnostic => {
          const from = Math.min(
            Math.max(0, diagnostic.location.range.from),
            length,
          );
          const to = Math.min(
            Math.max(from, diagnostic.location.range.to),
            length,
          );
          return {
            from,
            to,
            severity: diagnostic.severity === "information"
              ? "info"
              : diagnostic.severity,
            message: projectDiagnosticText(diagnostic.message),
            source: partial
              ? "project intelligence · partial"
              : "project intelligence",
            actions: [
              ...zoteroCitationActions(diagnostic, missingCount),
              ...relatedActions(diagnostic.related),
            ],
          };
        })
        .concat(staleBibliographyDiagnostics(current.snapshot, current.path, length));
    },
    {
      delay: 0,
      needsRefresh: needsProjectRefresh,
      // Diagnostics render through the shared hover card, so the stock lint
      // tooltip must not also appear.
      tooltipFilter: () => [],
    },
  );

  const lifecycle = ViewPlugin.define((view) => {
    let disposed = false;
    let refreshQueued = false;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const initialState = useIndexStore.getState().intelligenceState;
    let revision = diagnosticIdentity(initialState);
    let snapshot = initialState.data;
    const refresh = (requestGeneration: number) => {
      if (disposed) return;
      if (debounceTimer !== null) clearTimeout(debounceTimer);
      // Trailing debounce: intelligence updates stream in bursts while a
      // large project indexes; each forced lint re-runs full proofreading.
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        if (refreshQueued || disposed) return;
        refreshQueued = true;
        queueMicrotask(() => {
          refreshQueued = false;
          if (disposed || !view.dom.isConnected) return;
          view.dispatch({
            effects: [
              refreshProjectIntelligence.of(requestGeneration),
              closeHoverTooltips,
              clearProjectHoverIntel.of(null),
            ],
          });
          forceLinting(view);
        });
      }, 300);
    };
    const unsubscribe = useIndexStore.subscribe((store) => {
      const nextRevision = diagnosticIdentity(store.intelligenceState);
      const nextSnapshot = store.intelligenceState.data;
      if (nextRevision === revision && nextSnapshot === snapshot) return;
      revision = nextRevision;
      snapshot = nextSnapshot;
      refresh(store.intelligenceState.identity?.requestGeneration ?? 0);
    });
    const currentGeneration = () =>
      useIndexStore.getState().intelligenceState.identity?.requestGeneration ?? 0;
    const unsubscribeKeys = useZoteroLibraryStore.subscribe((store, previous) => {
      if (store.keysGeneration !== previous.keysGeneration) refresh(currentGeneration());
    });
    const unsubscribeStale = useZoteroStaleStore.subscribe((store, previous) => {
      if (store.revision !== previous.revision) refresh(currentGeneration());
    });
    return {
      update(update: ViewUpdate) {
        if (update.docChanged) {
          refresh(
            useIndexStore.getState().intelligenceState.identity
              ?.requestGeneration ?? 0,
          );
        }
      },
      destroy() {
        disposed = true;
        if (debounceTimer !== null) clearTimeout(debounceTimer);
        unsubscribe();
        unsubscribeKeys();
        unsubscribeStale();
      },
    };
  });

  return [diagnostics, lifecycle];
}

const LATEX_SOURCE_RE = /\.(?:tex|latex|ltx|sty|cls)$/i;

export function projectCompletionSourcesForPath(
  path: string | null,
): CompletionSource[] {
  if (!path || !SUPPORTED_SOURCE_RE.test(path)) return [];
  if (LATEX_SOURCE_RE.test(path)) {
    warmAtSuggestions();
    return [projectIntelligenceCompletion, atSuggestionCompletion];
  }
  return [projectIntelligenceCompletion];
}

const COMPLETION_LEADING_MARKS: ReadonlySet<string> = new Set(["#", "@", "<", '"']);
const COMPLETION_TRAILING_MARKS: ReadonlySet<string> = new Set([">", '"']);

function completionIdentity(option: Completion): string {
  const label = String(option.label);
  let start = 0;
  let end = label.length;
  while (start < end && COMPLETION_LEADING_MARKS.has(label[start])) start += 1;
  while (end > start && COMPLETION_TRAILING_MARKS.has(label[end - 1])) end -= 1;
  return label.slice(start, end);
}

function shiftedCompletion(option: Completion, offset: number): Completion {
  if (offset === 0) return option;
  const apply = option.apply;
  return {
    ...option,
    apply: (view, completion, from, to) => {
      const start = from + offset;
      if (typeof apply === "function") {
        apply(view, completion, start, to);
        return;
      }
      view.dispatch(
        insertCompletionText(
          view.state,
          typeof apply === "string" ? apply : String(option.label),
          start,
          to,
        ),
      );
    },
  };
}

export function mergeCompletionResults(
  primary: CompletionResult | null,
  secondary: CompletionResult | null,
): CompletionResult | null {
  if (!primary || primary.options.length === 0) return secondary;
  if (!secondary || secondary.options.length === 0) return primary;
  const seen = new Set(primary.options.map(completionIdentity));
  const extra = secondary.options.filter(
    (option) => !seen.has(completionIdentity(option)),
  );
  if (extra.length === 0) return primary;
  const from = Math.min(primary.from, secondary.from);
  return {
    from,
    options: [
      ...primary.options.map((option) =>
        shiftedCompletion(option, primary.from - from),
      ),
      ...extra.map((option) => shiftedCompletion(option, secondary.from - from)),
    ],
    filter: false,
  };
}

const mergedTypstSources = new WeakMap<CompletionSource, CompletionSource>();

export function typstCompletionWithLanguageService(
  languageService: CompletionSource,
): CompletionSource {
  const cached = mergedTypstSources.get(languageService);
  if (cached) return cached;
  const source: CompletionSource = async (context) => {
    const local =
      typstBibliographyStyleCompletions(context) ??
      typstBibliographyParameterCompletions(context) ??
      (shouldRunCompletionSource(context, "typst")
        ? projectIntelligenceCompletion(context)
        : null);
    const [remote, own] = await Promise.all([languageService(context), local]);
    return mergeCompletionResults(remote, own);
  };
  mergedTypstSources.set(languageService, source);
  return source;
}

const MARKDOWN_SOURCE_RE = /\.(?:md|markdown)$/i;
const latexCitationSource = zoteroCitationSource(
  "latex",
  gateCompletionSource(projectIntelligenceCompletion, "latex"),
);
const markdownCitationSource = zoteroCitationSource(
  "markdown",
  gateCompletionSource(projectIntelligenceCompletion, "markdown"),
);
const typstCitationSources = new WeakMap<CompletionSource, CompletionSource>();

function typstCitationSource(languageService: CompletionSource): CompletionSource {
  const cached = typstCitationSources.get(languageService);
  if (cached) return cached;
  const source = zoteroCitationSource("typst", typstCompletionWithLanguageService(languageService));
  typstCitationSources.set(languageService, source);
  return source;
}

export function editorCompletionSourcesForPath(
  path: string | null,
  languageService: CompletionSource,
): CompletionSource[] {
  if (path && TYPST_SOURCE_RE.test(path)) {
    return [typstCitationSource(languageService)];
  }
  if (path && LATEX_SOURCE_RE.test(path)) {
    warmAtSuggestions();
    return [languageService, latexCitationSource, atSuggestionCompletion];
  }
  if (path && MARKDOWN_SOURCE_RE.test(path)) {
    return [languageService, markdownCitationSource];
  }
  return [languageService, ...projectCompletionSourcesForPath(path)];
}
