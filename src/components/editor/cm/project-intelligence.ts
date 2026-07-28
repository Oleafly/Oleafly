import {
  closeCompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
  type CompletionSource,
} from "@codemirror/autocomplete";
import { forceLinting, linter, type Action, type Diagnostic } from "@codemirror/lint";
import { StateEffect, type Extension } from "@codemirror/state";
import {
  closeHoverTooltips,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import { clearProjectHoverIntel } from "./hover-intel";
import { citationCompletions } from "@/lib/project-intelligence/selectors";
import { currentSourceProjectIntelligence } from "@/lib/project-intelligence/current";
import { navigateToProjectRange } from "@/lib/project-intelligence/navigation";
import type {
  CitationCompletion,
  ProjectDefinition,
  ProjectIntelligenceSnapshot,
  ProjectIntelligenceState,
} from "@/lib/project-intelligence/types";
import { useFilesStore } from "@/store/files";
import { useIndexStore } from "@/store/project-index";

const SUPPORTED_SOURCE_RE = /\.(?:tex|latex|ltx|sty|cls|md|markdown|typ|bib)$/i;
const TOKEN_RE = /^[\p{L}\p{N}_:.+/@-]*$/u;
const COMPLETION_LIMIT = 200;
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
}

function guardedApply(guard: CompletionGuard, insert: string): NonNullable<Completion["apply"]> {
  return (view, _completion, from, to) => {
    const current = currentSourceProjectIntelligence(
      view.state.doc.toString(),
    );
    if (
      !current ||
      current.path !== guard.path ||
      current.snapshot !== guard.snapshot
    ) {
      closeCompletion(view);
      return;
    }
    view.dispatch({
      changes: { from, to, insert },
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
    .slice(0, COMPLETION_LIMIT)
    .map((definition) => {
      const duplicateCount = counts.get(definition.name) ?? 1;
      const duplicateDetail =
        duplicateCount > 1 ? ` · duplicate (${duplicateCount})` : "";
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
        apply: guardedApply(guard, definition.name),
      };
    });
}

function citationOptions(
  snapshot: ProjectIntelligenceSnapshot,
  guard: CompletionGuard,
  query: string,
): Completion[] {
  return citationCompletions(snapshot, query, COMPLETION_LIMIT).map(
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

function completionResult(
  from: number,
  options: Completion[],
): CompletionResult | null {
  if (options.length === 0) return null;
  return {
    from,
    options,
    validFor: TOKEN_RE,
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
    );
    const projectNames = new Set(
      project.map((option) => option.label),
    );
    const standard = STANDARD_LATEX_ENVIRONMENTS
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
      [...project, ...standard].slice(0, COMPLETION_LIMIT),
    );
  }

  const packageName =
    /\\usepackage\s*(?:\[[^\]]*\])?\{[^{}]*?(?:,\s*)?([^,{}]*)$/u.exec(
      before,
    );
  if (packageName) {
    const query = (packageName[1] ?? "").trimStart();
    return completionResult(
      context.pos - query.length,
      STANDARD_LATEX_PACKAGES.filter((name) =>
        name
          .toLocaleLowerCase()
          .includes(query.toLocaleLowerCase()),
      ).map((name) => ({
        label: name,
        type: "namespace",
        detail: "LaTeX package",
        apply: guardedApply(guard, name),
      })),
    );
  }

  const documentClass =
    /\\documentclass\s*(?:\[[^\]]*\])?\{([^{}]*)$/u.exec(before);
  if (documentClass) {
    const query = documentClass[1] ?? "";
    return completionResult(
      context.pos - query.length,
      STANDARD_LATEX_CLASSES.filter((name) =>
        name
          .toLocaleLowerCase()
          .includes(query.toLocaleLowerCase()),
      ).map((name) => ({
        label: name,
        type: "type",
        detail: "LaTeX document class",
        apply: guardedApply(guard, name),
      })),
    );
  }

  const fileTarget =
    /\\(?:input|include|subfile|includegraphics|bibliography|addbibresource)\s*(?:\[[^\]]*\])?\{([^{}]*)$/u.exec(
      before,
    );
  if (fileTarget) {
    const query = fileTarget[1] ?? "";
    return completionResult(
      context.pos - query.length,
      definitionOptions(
        snapshot,
        guard,
        new Set(["file"]),
        query,
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

  const reference = /\\(?:ref|eqref|pageref|autoref|[cC]ref|nameref)\*?\{[^{}]*?(?:,\s*)?([^,{}]*)$/u.exec(
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

  const command = /\\([A-Za-z@]*)$/u.exec(before);
  if (command) {
    const query = command[1] ?? "";
    return completionResult(
      context.pos - query.length,
      definitionOptions(
        snapshot,
        guard,
        new Set(["macro"]),
        query,
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
      COMPLETION_LIMIT,
    ),
  );
}

function typstCompletion(
  context: CompletionContext,
  snapshot: ProjectIntelligenceSnapshot,
  guard: CompletionGuard,
  before: string,
): CompletionResult | null {
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
    ].slice(0, COMPLETION_LIMIT),
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
  if (!current || !SUPPORTED_SOURCE_RE.test(current.path)) return null;

  const guard: CompletionGuard = {
    path: current.path,
    snapshot: current.snapshot,
  };
  const before = context.state.sliceDoc(
    Math.max(0, context.pos - 1_000),
    context.pos,
  );
  const path = current.path.toLocaleLowerCase();
  if (/\.(?:tex|latex|ltx|sty|cls)$/.test(path)) {
    return latexCompletion(context, current.snapshot, guard, before);
  }
  if (/\.(?:md|markdown)$/.test(path)) {
    return markdownCompletion(context, current.snapshot, guard, before);
  }
  if (path.endsWith(".typ")) {
    return typstCompletion(context, current.snapshot, guard, before);
  }
  if (path.endsWith(".bib")) {
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

function localReferenceDiagnostics(
  path: string,
  text: string,
): Diagnostic[] {
  if (!SUPPORTED_SOURCE_RE.test(path)) return [];

  const files = useFilesStore.getState();
  const indexedTexts = useIndexStore.getState().texts;
  const sources = new Map<string, string>(Object.entries(indexedTexts));
  for (const [file, state] of Object.entries(files.files)) {
    sources.set(file, state.content);
  }

  const labels = new Map<string, number>();
  const citations = new Set<string>();
  for (const [file, source] of sources) {
    if (/\.(?:tex|latex|ltx|sty|cls)$/iu.test(file)) {
      for (const match of source.matchAll(/\\label\s*\{([^{}]+)\}/gu)) {
        const key = match[1]?.trim();
        if (key) labels.set(key, (labels.get(key) ?? 0) + 1);
      }
    }
    if (/\.bib$/iu.test(file)) {
      for (const match of source.matchAll(/@[^\s({]+\s*[({]\s*([^,\s}]+)/giu)) {
        const key = match[1]?.trim();
        if (key) citations.add(key);
      }
    }
  }

  const diagnostics: Diagnostic[] = [];
  const add = (from: number, to: number, message: string) => {
    diagnostics.push({
      from,
      to: Math.max(from + 1, to),
      severity: "warning",
      message,
      source: "live references",
    });
  };

  const referencePattern = /\\(?:ref|eqref|pageref|autoref|cref|Cref|namecref|nameref|Vref|vref|fref|sref|labelref)\*?\s*(?:\[[^\]]*\]\s*)?\{([^{}]*)\}/gu;
  for (const match of text.matchAll(referencePattern)) {
    const body = match[1] ?? "";
    const bodyStart = (match.index ?? 0) + match[0].indexOf(body);
    for (const rawKey of body.split(",")) {
      const key = rawKey.trim();
      if (!key) continue;
      const offset = bodyStart + body.indexOf(rawKey) + rawKey.search(/\S/u);
      if (!labels.has(key)) {
        add(offset, offset + key.length, `Unresolved reference: ${key}`);
      } else if ((labels.get(key) ?? 0) > 1) {
        add(offset, offset + key.length, `Duplicate label definition: ${key}`);
      }
    }
  }

  const citationPattern = /\\(?:[A-Za-z]*cite[A-Za-z]*|nocite)\*?(?:\[[^\]]*\]\s*)?\{([^{}]*)\}/gu;
  for (const match of text.matchAll(citationPattern)) {
    const body = match[1] ?? "";
    const bodyStart = (match.index ?? 0) + match[0].indexOf(body);
    for (const rawKey of body.split(",")) {
      const key = rawKey.trim();
      if (!key) continue;
      const offset = bodyStart + body.indexOf(rawKey) + rawKey.search(/\S/u);
      if (!citations.has(key)) {
        add(offset, offset + key.length, `Unresolved citation: ${key}`);
      }
    }
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
          ? localReferenceDiagnostics(path, view.state.doc.toString())
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
    const initialState = useIndexStore.getState().intelligenceState;
    let revision = diagnosticIdentity(initialState);
    let snapshot = initialState.data;
    const refresh = (requestGeneration: number) => {
      closeCompletion(view);
      if (refreshQueued) return;
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
        unsubscribe();
      },
    };
  });

  return [diagnostics, lifecycle];
}

export function projectCompletionSourcesForPath(
  path: string | null,
): CompletionSource[] {
  return path && SUPPORTED_SOURCE_RE.test(path)
    ? [projectIntelligenceCompletion]
    : [];
}
