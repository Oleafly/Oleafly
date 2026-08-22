import {
  closeCompletion,
  snippet,
  type Completion,
  type CompletionContext,
  type CompletionResult,
  type CompletionSource,
} from "@codemirror/autocomplete";
import {
  completionRequestIsCurrent,
  createCompletionRequestGuard,
  latexReferenceCitationCompletions,
  type CompletionRequestGuard,
} from "@oleafly/editor";
import { forceLinting, linter, type Action, type Diagnostic } from "@codemirror/lint";
import { StateEffect, type Extension } from "@codemirror/state";
import {
  closeHoverTooltips,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import { auxNumberFor } from "@/lib/aux-numbers";
import {
  atSuggestionCompletion,
  warmAtSuggestions,
} from "./at-suggestions";
import { clearProjectHoverIntel } from "./hover-intel";
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
import { citationCompletions } from "@/lib/project-intelligence/selectors";
import { currentSourceProjectIntelligence } from "@/lib/project-intelligence/current";
import { navigateToProjectRange } from "@/lib/project-intelligence/navigation";
import type {
  CitationCompletion,
  ProjectDefinition,
  ProjectIntelligenceSnapshot,
  ProjectIntelligenceState,
  ProjectUse,
} from "@/lib/project-intelligence/types";
import { useFilesStore } from "@/store/files";
import { useIndexStore } from "@/store/project-index";

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
  snapshot: ProjectIntelligenceSnapshot;
  request: CompletionRequestGuard;
}

function guardedApply(
  guard: CompletionGuard,
  insert: string,
  asSnippet = false,
  replaceClosingBrace = false,
): NonNullable<Completion["apply"]> {
  return (view, completion, from, to) => {
    const current = currentSourceProjectIntelligence(
      view.state.doc.toString(),
    );
    if (
      !completionRequestIsCurrent(guard.request, view.state) ||
      !current ||
      current.path !== guard.path ||
      current.snapshot !== guard.snapshot
    ) {
      closeCompletion(view);
      return;
    }
    const targetTo =
      replaceClosingBrace && view.state.sliceDoc(to, to + 1) === "}"
        ? to + 1
        : to;
    if (asSnippet) {
      snippet(insert)(view, completion, from, targetTo);
      return;
    }
    view.dispatch({
      changes: { from, to: targetTo, insert },
      selection: { anchor: from + insert.length },
    });
  };
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

function definitionOptions(
  snapshot: ProjectIntelligenceSnapshot,
  guard: CompletionGuard,
  kinds: ReadonlySet<ProjectDefinition["kind"]>,
  query: string,
  includeEnvironmentArguments = false,
): Completion[] {
  const normalizedQuery = query.toLocaleLowerCase();
  const candidates = snapshot.definitions.filter(
    (definition) =>
      kinds.has(definition.kind) &&
      (!normalizedQuery ||
        definition.name.toLocaleLowerCase().includes(normalizedQuery)),
  );
  const counts = new Map<string, number>();
  for (const candidate of candidates) {
    counts.set(candidate.name, (counts.get(candidate.name) ?? 0) + 1);
  }

  return candidates
    .sort((left, right) => {
      const leftPrefix = left.name.toLocaleLowerCase().startsWith(normalizedQuery);
      const rightPrefix = right.name.toLocaleLowerCase().startsWith(normalizedQuery);
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
        duplicateCount > 1 ? ` · duplicate (${duplicateCount})` : ""
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
      const insertion = environmentWithArguments
        ? `${definition.name}}${argumentsSnippet}`
        : `${definition.name}${argumentsSnippet}`;
      return {
        label: definition.name,
        type:
          definition.kind === "bibentry"
            ? "constant"
            : definition.kind === "macro"
              ? "function"
              : "variable",
        detail: `${definition.kind}${duplicateDetail} · ${basename(definition.location.file)}:${definition.location.range.startLine}`,
        info: definition.detail,
        apply: guardedApply(
          guard,
          insertion,
          argumentsSnippet.length > 0,
          environmentWithArguments,
        ),
      };
    });
}

function citationOptions(
  snapshot: ProjectIntelligenceSnapshot,
  guard: CompletionGuard,
  query: string,
): Completion[] {
  return citationCompletions(
    snapshot,
    query,
    FILTERED_COMPLETION_LIMIT,
  ).map(
    (candidate: CitationCompletion) => {
      const duplicate = candidate.duplicate
        ? ` · duplicate ${candidate.duplicateIndex + 1}/${candidate.duplicateCount}`
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
): CompletionResult | null {
  if (options.length === 0) return null;
  return {
    from,
    options,
    filter: true,
  };
}

function latexCompletion(
  context: CompletionContext,
  snapshot: ProjectIntelligenceSnapshot,
  guard: CompletionGuard,
  before: string,
): CompletionResult | null {
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
        detail: "standard LaTeX environment",
        boost:
          environment[1] === "end" &&
          before.includes(`\\begin{${name}}`)
            ? 50
            : undefined,
        apply: guardedApply(guard, name),
      } satisfies Completion));
    return completionResult(
      context.pos - query.length,
      [...project, ...standard].slice(
        0,
        FILTERED_COMPLETION_LIMIT,
      ),
    );
  }

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
        detail: `${packageOption.name} option`,
        apply: guardedApply(guard, option),
      } satisfies Completion));
    if (filtered.length) {
      return completionResult(
        context.pos - query.length,
        filtered,
      );
    }
  }

  const packageName =
    /\\usepackage\s*(?:\[[^\]]*\])?\{[^{}]*?(?:,\s*)?([^,{}]*)$/u.exec(
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
          detail: names?.details[name] ?? "LaTeX package",
          ...(names
            ? { info: corpusNameInfo(name, names.details[name]) }
            : {}),
          apply: guardedApply(guard, name),
        })),
    );
  }

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
          detail: names?.details[name] ?? "LaTeX document class",
          ...(names
            ? { info: corpusNameInfo(name, names.details[name]) }
            : {}),
          apply: guardedApply(guard, name),
        })),
    );
  }

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
    );
  }

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
    );
  }

  const citation = /\\(?:[A-Za-z]*cite[A-Za-z]*|nocite)\*?(?:\[[^\]]*\])*\{[^{}]*?(?:,\s*)?([^,{}]*)$/u.exec(
    before,
  );
  if (citation) {
    const query = (citation[1] ?? "").trimStart();
    return completionResult(
      context.pos - query.length,
      citationOptions(snapshot, guard, query),
    );
  }

  const reference = /\\(?:ref|eqref|pageref|autoref|[cC]ref|cpageref|vref|Vref|labelcref|nameref|namecref|fref|sref|labelref)\*?\s*\{[^{}]*?(?:,\s*)?([^,{}]*)$/u.exec(
    before,
  );
  if (reference) {
    const query = (reference[1] ?? "").trimStart();
    return completionResult(
      context.pos - query.length,
      definitionOptions(
        snapshot,
        guard,
        new Set(["label", "anchor"]),
        query,
      ),
    );
  }

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
    );
  }

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
          detail: `\\${keyval.command} key`,
          apply: guardedApply(guard, key),
        } satisfies Completion)),
      );
    }
  }

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
            detail: macro.detail ?? "package command",
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
  return null;
}

function markdownCompletion(
  context: CompletionContext,
  snapshot: ProjectIntelligenceSnapshot,
  guard: CompletionGuard,
  before: string,
): CompletionResult | null {
  const anchor = /\]\(#([\p{L}\p{N}_:.+/-]*)$/u.exec(before);
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
    );
  }

  const at = /(?:^|[[(\s;,])@([\p{L}\p{N}_:.+/-]*)$/u.exec(before);
  if (!at || before.endsWith("\\@")) return null;
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
  );
}

function typstCompletion(
  context: CompletionContext,
  snapshot: ProjectIntelligenceSnapshot,
  guard: CompletionGuard,
  before: string,
): CompletionResult | null {
  const explicitCitation =
    /#cite\s*\([\s\S]{0,500}(?:<|label\s*\(\s*"|")([\p{L}\p{N}_:.+/-]*)$/u.exec(
      before,
    );
  if (explicitCitation) {
    const query = explicitCitation[1] ?? "";
    return completionResult(
      context.pos - query.length,
      citationOptions(snapshot, guard, query),
    );
  }

  const explicitReference = /#(?:ref|link)\(\s*<([\p{L}\p{N}_:.+/-]*)$/u.exec(
    before,
  );
  if (explicitReference) {
    const query = explicitReference[1] ?? "";
    return completionResult(
      context.pos - query.length,
      definitionOptions(
        snapshot,
        guard,
        new Set(["label", "anchor", "section"]),
        query,
      ),
    );
  }

  const at = /(?:^|[\s[(;,])@([\p{L}\p{N}_:.+/-]*)$/u.exec(before);
  if (!at) return null;
  const query = at[1] ?? "";
  return completionResult(
    context.pos - query.length,
    [
      ...citationOptions(snapshot, guard, query),
      ...definitionOptions(
        snapshot,
        guard,
        new Set(["label", "anchor", "section"]),
        query,
      ),
    ].slice(0, FILTERED_COMPLETION_LIMIT),
  );
}

function bibtexCompletion(
  context: CompletionContext,
  snapshot: ProjectIntelligenceSnapshot,
  guard: CompletionGuard,
  before: string,
): CompletionResult | null {
  const crossReference = /(?:crossref|xref|xdata|related|entryset)\s*=\s*["{]\s*([\p{L}\p{N}_:.+/-]*)$/iu.exec(
    before,
  );
  if (!crossReference) return null;
  const query = crossReference[1] ?? "";
  return completionResult(
    context.pos - query.length,
    citationOptions(snapshot, guard, query),
  );
}

export const projectIntelligenceCompletion: CompletionSource = (
  context,
): CompletionResult | null => {
  const current = currentSourceProjectIntelligence(
    context.state.doc.toString(),
  );
  const path = current?.path ?? useFilesStore.getState().activePath;
  if (!path || !SUPPORTED_SOURCE_RE.test(path)) return null;
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
  if (normalizedPath.endsWith(".typ")) {
    return typstCompletion(context, current.snapshot, guard, before);
  }
  if (normalizedPath.endsWith(".bib")) {
    return bibtexCompletion(context, current.snapshot, guard, before);
  }
  return null;
};

function relatedActions(
  related: ProjectIntelligenceSnapshot["diagnostics"][number]["related"],
): Action[] {
  return related.slice(0, 3).map((item) => ({
    name: item.message,
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
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
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

interface DefinitionCountIndex {
  readonly total: ReadonlyMap<string, number>;
  readonly byFile: ReadonlyMap<string, ReadonlyMap<string, number>>;
}

interface FallbackLookup {
  readonly references: DefinitionCountIndex;
  readonly citations: DefinitionCountIndex;
}

const fallbackLookupCache = new WeakMap<
  ProjectIntelligenceSnapshot,
  FallbackLookup
>();

function definitionCountIndex(
  snapshot: ProjectIntelligenceSnapshot,
  kind: "reference" | "citation",
): DefinitionCountIndex {
  const total = new Map<string, number>();
  const byFile = new Map<string, Map<string, number>>();
  for (const definition of snapshot.definitions) {
    const accepted =
      kind === "citation"
        ? definition.kind === "bibentry"
        : definition.kind === "label" ||
          definition.kind === "anchor";
    if (!accepted) continue;
    const fileCounts =
      byFile.get(definition.location.file) ?? new Map<string, number>();
    fileCounts.set(
      definition.name,
      (fileCounts.get(definition.name) ?? 0) + 1,
    );
    byFile.set(definition.location.file, fileCounts);
    // Pandoc anchors are file-scoped. They remain in byFile for local and
    // explicit cross-file links, but never enter the global reference pool.
    if (
      kind === "reference" &&
      definition.engine === "markdown" &&
      definition.kind === "anchor"
    ) {
      continue;
    }
    total.set(
      definition.name,
      (total.get(definition.name) ?? 0) + 1,
    );
  }
  return { total, byFile };
}

function fallbackLookup(
  snapshot: ProjectIntelligenceSnapshot,
): FallbackLookup {
  const cached = fallbackLookupCache.get(snapshot);
  if (cached) return cached;
  const lookup = {
    references: definitionCountIndex(snapshot, "reference"),
    citations: definitionCountIndex(snapshot, "citation"),
  };
  fallbackLookupCache.set(snapshot, lookup);
  return lookup;
}

function countExceptFile(
  index: DefinitionCountIndex,
  key: string,
  path: string,
): number {
  return Math.max(
    0,
    (index.total.get(key) ?? 0) -
      (index.byFile.get(path)?.get(key) ?? 0),
  );
}

function countCurrentDefinitions(
  definitions: readonly ProjectDefinition[],
  key: string,
  kind: "reference" | "citation",
): number {
  return definitions.filter(
    (definition) =>
      definition.name === key &&
      (kind === "citation"
        ? definition.kind === "bibentry"
        : definition.kind === "label" ||
          definition.kind === "anchor"),
  ).length;
}

function referenceCount(
  use: ProjectUse,
  path: string,
  definitions: readonly ProjectDefinition[],
  lookup: FallbackLookup,
): number {
  if (use.target?.includes("#")) {
    const [targetFile, targetName] = use.target.split("#", 2);
    if (targetFile === path) {
      return countCurrentDefinitions(
        definitions,
        targetName || use.name,
        "reference",
      );
    }
    return (
      lookup.references.byFile
        .get(targetFile)
        ?.get(targetName || use.name) ?? 0
    );
  }
  if (use.engine === "markdown") {
    return countCurrentDefinitions(
      definitions,
      use.name,
      "reference",
    );
  }
  return (
    countExceptFile(lookup.references, use.name, path) +
    countCurrentDefinitions(definitions, use.name, "reference")
  );
}

function citationCount(
  use: ProjectUse,
  path: string,
  definitions: readonly ProjectDefinition[],
  lookup: FallbackLookup,
): number {
  return (
    countExceptFile(lookup.citations, use.name, path) +
    countCurrentDefinitions(definitions, use.name, "citation")
  );
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
    !snapshot.files[path] ||
    indexed.texts[path] === undefined
  ) {
    return [];
  }

  let currentFile: ReturnType<typeof analyzeProjectFile>;
  try {
    currentFile = analyzeProjectFile(
      path,
      text,
      snapshot.files[path].sourceRevision + 1,
    );
  } catch {
    // The authoritative worker owns error presentation. A fallback parser
    // failure must never turn into guessed or unmasked findings.
    return [];
  }
  const lookup = fallbackLookup(snapshot);
  const diagnostics: Diagnostic[] = [];
  for (const use of currentFile.uses) {
    if (use.kind !== "reference" && use.kind !== "citation") continue;
    const references =
      use.kind === "reference"
        ? referenceCount(use, path, currentFile.definitions, lookup)
        : 0;
    const citations =
      use.kind === "citation" || use.syntax === "typst-at"
        ? citationCount(use, path, currentFile.definitions, lookup)
        : 0;
    const candidates = references + citations;
    if (candidates === 1) continue;
    const noun =
      use.syntax === "typst-at"
        ? "Typst label or citation"
        : use.kind === "citation"
          ? "Citation"
          : "Reference";
    diagnostics.push({
      from: use.location.range.from,
      to: Math.max(
        use.location.range.from + 1,
        use.location.range.to,
      ),
      severity: "warning",
      message:
        candidates === 0
          ? `Unresolved ${noun.toLocaleLowerCase("en-US")}: ${use.name}`
          : `${noun} "${use.name}" has ${candidates} possible definitions.`,
      source: "live references · current file",
    });
  }
  return diagnostics;
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
      return current.snapshot.diagnostics
        .filter((diagnostic) => diagnostic.location.file === current.path)
        .map((diagnostic) => {
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
            message: diagnostic.message,
            source: partial
              ? "project intelligence · partial"
              : "project intelligence",
            actions: relatedActions(diagnostic.related),
          };
        });
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
