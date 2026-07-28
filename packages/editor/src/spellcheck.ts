import {
  linter,
  lintGutter,
  forceLinting,
  type Diagnostic,
  type Action,
} from "@codemirror/lint";
import { StateEffect } from "@codemirror/state";
import { tooltips } from "@codemirror/view";
import type { EditorView, ViewUpdate } from "@codemirror/view";

import { maskToProse, spellcheckRanges } from "./latex-mask";
import {
  attachProofreadingCard,
  diagnosticCardGutter,
  diagnosticCardTooltip,
} from "./diagnostic-card";
import { markdownSpellcheckRanges, markdownToProse } from "./markdown-mask";
import type {
  ProofreadingFormat,
  ProofreadingDialect,
  ProofreadingMode,
  ProofreadingResult,
} from "./proofreading";

export interface GrammarSuggestion {
  text: string;
  // 0 = Replace, 1 = Remove, 2 = InsertAfter.
  kind: number;
}

export interface GrammarDiag {
  from: number;
  to: number;
  message: string;
  kind: string;
  suggestions: GrammarSuggestion[];
}

// Installed once via setSpellHost; the linters are inert without it.
export interface SpellHost {
  getProjectId(): string | null;
  getActivePath(): string | null;
  getLintPrefs(): {
    showRegionalism: boolean;
    showWordChoice: boolean;
    dialect?: ProofreadingDialect;
  };
  proofread?(input: {
    projectId: string | null;
    path: string;
    revision: number;
    surface: "source";
    text: string;
    format: ProofreadingFormat;
    mode: ProofreadingMode;
    preferences: {
      showRegionalism: boolean;
      showWordChoice: boolean;
      dialect?: ProofreadingDialect;
    };
  }): Promise<ProofreadingResult>;
  cancelProofreading?(surface: "source", path?: string): void;
  getSpellchecker?(): Promise<{ spell(word: string): boolean }>;
  isSessionIgnored(word: string): boolean;
  isWordIgnored(projectId: string | null, word: string): boolean;
  ignoreWordForProject(projectId: string, word: string): void;
  ignoreWordGlobally(word: string): void;
  lintGrammar?(prose: string, maxLen: number): Promise<GrammarDiag[]>;
}

let host: SpellHost | null = null;
export function setSpellHost(h: SpellHost) {
  host = h;
}

export function cancelSourceProofreading(path?: string): void {
  host?.cancelProofreading?.("source", path);
}

// Dispatched when the ignore list changes. `forceLinting` alone is a no-op when
// the editor is idle (the lint plugin only re-runs if a lint is already
// pending), so we tie the linters' `needsRefresh` to this effect: dispatching it
// marks a re-lint as needed, and forceLinting then flushes it immediately.
const refreshLints = StateEffect.define<null>();

function needsRefresh(update: ViewUpdate): boolean {
  return update.transactions.some((tr) =>
    tr.effects.some((e) => e.is(refreshLints))
  );
}

export function refreshEditorLints(view: EditorView | null): void {
  if (!view) return;
  view.dispatch({ effects: refreshLints.of(null) });
  forceLinting(view);
}

/** Short labels for the card footer; the stock tooltip needs the full sentence. */
function ignoreEntries(
  h: SpellHost,
  projectId: string | null,
  word: string,
): { label: string; action: Action }[] {
  return ignoreActions(h, projectId, word).map((action, index) => ({
    label: projectId && index === 0 ? "Ignore" : "Ignore everywhere",
    action,
  }));
}

function suggestionEntries(
  suggestions: GrammarSuggestion[],
): { label: string; action: Action }[] {
  return suggestionActions(suggestions).map((action, index) => ({
    // The action name is a quoted, elided preview meant for a button strip.
    // Rows have room for the replacement itself.
    label: labelForSuggestion(suggestions[index]),
    action,
  }));
}

function labelForSuggestion(suggestion: GrammarSuggestion | undefined): string {
  if (!suggestion) return "";
  if (suggestion.kind === 1) return "Remove";
  if (suggestion.kind === 2) return `Add “${suggestion.text}”`;
  return suggestion.text;
}

/**
 * Builds a diagnostic that the proofreading hover card can render, keeping the
 * plain `actions` so the lint panel and keyboard flows still work.
 */
function proofreadingDiagnostic(
  h: SpellHost,
  projectId: string | null,
  word: string,
  suggestions: GrammarSuggestion[],
  diagnostic: Omit<Diagnostic, "actions">,
): Diagnostic {
  const suggestionList = suggestionEntries(suggestions);
  const ignoreList = ignoreEntries(h, projectId, word);
  return attachProofreadingCard(
    {
      ...diagnostic,
      actions: [
        ...suggestionList.map((entry) => entry.action),
        ...ignoreList.map((entry) => entry.action),
      ],
    },
    { word, suggestions: suggestionList, ignores: ignoreList },
  );
}

function ignoreActions(h: SpellHost, projectId: string | null, word: string): Action[] {
  const refresh = (view: Parameters<Action["apply"]>[0]) => {
    view.dispatch({ effects: refreshLints.of(null) }); // mark re-lint needed
    forceLinting(view); // ...then run it now so the warning clears immediately
  };
  const short = word.length > 22 ? `${word.slice(0, 21)}…` : word;
  const actions: Action[] = [];
  if (projectId) {
    actions.push({
      name: `Ignore “${short}” in this project`,
      apply: (view) => {
        h.ignoreWordForProject(projectId, word);
        refresh(view);
      },
    });
  }
  actions.push({
    name: `Ignore “${short}” everywhere`,
    apply: (view) => {
      h.ignoreWordGlobally(word);
      refresh(view);
    },
  });
  return actions;
}

let sourceRevision = 0;

/** Every diagnostic renders through the shared hover card instead. */
function noLintTooltip(): Diagnostic[] {
  return [];
}

function formatForPath(path: string): ProofreadingFormat | null {
  if (/\.(?:tex|latex|ltx)$/iu.test(path)) return "latex";
  if (/\.(?:md|markdown)$/iu.test(path)) return "markdown";
  if (/\.typ$/iu.test(path)) return "typst";
  return null;
}

async function proofreadWithWorker(
  h: SpellHost,
  view: EditorView,
  mode: ProofreadingMode,
): Promise<Diagnostic[] | null> {
  if (!h.proofread) return null;
  const projectId = h.getProjectId();
  const path = h.getActivePath() ?? "";
  const format = formatForPath(path);
  if (!format) return [];
  const document = view.state.doc;
  const text = document.toString();
  const result = await h.proofread({
    projectId,
    path,
    revision: ++sourceRevision,
    surface: "source",
    text,
    format,
    mode,
    preferences: h.getLintPrefs(),
  });
  if (
    result.status !== "ready" ||
    view.state.doc !== document ||
    h.getProjectId() !== projectId ||
    h.getActivePath() !== path
  ) {
    return [];
  }
  const output: Diagnostic[] = [];
  for (const diagnostic of result.diagnostics) {
    const from = Math.max(
      0,
      Math.min(diagnostic.from, view.state.doc.length),
    );
    const to = Math.max(
      from,
      Math.min(diagnostic.to, view.state.doc.length),
    );
    if (to <= from) continue;
    const word = diagnostic.word || text.slice(from, to);
    if (
      h.isSessionIgnored(word) ||
      h.isWordIgnored(projectId, word)
    ) {
      continue;
    }
    output.push(
      proofreadingDiagnostic(h, projectId, word, diagnostic.suggestions, {
        from,
        to,
        severity: "warning",
        message: diagnostic.message,
      }),
    );
  }
  return output;
}

export function createSpellLinter() {
  return linter(
    async (view): Promise<Diagnostic[]> => {
      const h = host;
      if (!h) return [];
      try {
        const workerDiagnostics = await proofreadWithWorker(
          h,
          view,
          "spelling",
        );
        if (workerDiagnostics) return workerDiagnostics;
        if (!h.getSpellchecker) return [];
        const hunspell = await h.getSpellchecker();
        const projectId = h.getProjectId();
        const path = h.getActivePath() ?? "";
        const text = view.state.doc.toString();
        const ranges = /\.(?:md|markdown)$/i.test(path)
          ? markdownSpellcheckRanges(text)
          : spellcheckRanges(text);
        const diags: Diagnostic[] = [];
        for (const r of ranges) {
          if (r.word.length < 2 || h.isSessionIgnored(r.word)) continue;
          if (h.isWordIgnored(projectId, r.word)) continue;
          try {
            if (!hunspell.spell(r.word)) {
              diags.push(
                proofreadingDiagnostic(h, projectId, r.word, [], {
                  from: r.from,
                  to: r.to,
                  severity: "warning",
                  message: `Possible misspelling: "${r.word}"`,
                }),
              );
            }
          } catch {
            /* skip */
          }
        }
        return diags;
      } catch {
        return [];
      }
    },
    // Longer debounce on large docs reduces main-thread pressure while typing.
    { delay: 700, needsRefresh, tooltipFilter: noLintTooltip }
  );
}

function suggestionActions(sugs: GrammarSuggestion[]): Action[] {
  return sugs.slice(0, 4).map<Action>((s) => {
    const preview =
      s.text.length > 44 ? `${s.text.slice(0, 43)}…` : s.text;
    return {
      name:
        s.kind === 1
          ? "Remove"
          : s.kind === 2
            ? `Add “${preview}”`
            : `“${preview}”`,
      apply: (view, from, to) => {
        if (s.kind === 2) {
          view.dispatch({ changes: { from: to, insert: s.text } });
        } else if (s.kind === 1) {
          view.dispatch({ changes: { from, to } });
        } else {
          view.dispatch({ changes: { from, to, insert: s.text } });
        }
      },
    };
  });
}

const MAX_GRAMMAR_CHARS = 150_000;

function localGrammarFallback(
  text: string,
  path: string,
  h: SpellHost,
): Diagnostic[] {
  const masked = /\.(?:md|markdown)$/i.test(path)
    ? markdownToProse(text)
    : maskToProse(text);
  const diagnostics: Diagnostic[] = [];
  const add = (
    from: number,
    to: number,
    message: string,
    suggestions: GrammarSuggestion[] = [],
  ) => {
    const word = text.slice(from, to);
    if (!word || h.isSessionIgnored(word) || h.isWordIgnored(h.getProjectId(), word)) {
      return;
    }
    diagnostics.push({
      from,
      to,
      severity: "warning",
      message,
      actions: [...suggestionActions(suggestions), ...ignoreActions(h, h.getProjectId(), word)],
    });
  };

  for (const match of masked.prose.matchAll(/\b([\p{L}][\p{L}'’-]*)\s+\1\b/giu)) {
    if (match.index === undefined) continue;
    const from = masked.map[match.index];
    const to = masked.map[match.index + match[0].length - 1];
    if (from === undefined || to === undefined) continue;
    add(from, to + 1, `Repeated word: “${match[1]}”`);
  }

  const corrections: Record<string, string> = {
    teh: "the",
    recieve: "receive",
    seperate: "separate",
    occurence: "occurrence",
    definately: "definitely",
    dont: "don't",
    cant: "can't",
    wont: "won't",
    isnt: "isn't",
    hasnt: "hasn't",
  };
  const typoPattern = new RegExp(
    `\\b(${Object.keys(corrections).join("|")})\\b`,
    "giu",
  );
  for (const match of masked.prose.matchAll(typoPattern)) {
    if (match.index === undefined) continue;
    const from = masked.map[match.index];
    const to = masked.map[match.index + match[0].length - 1];
    const replacement = corrections[(match[1] ?? "").toLocaleLowerCase()];
    if (from === undefined || to === undefined || !replacement) continue;
    add(from, to + 1, `Possible spelling or grammar issue: “${match[0]}”`, [
      { text: replacement, kind: 0 },
    ]);
  }
  return diagnostics;
}

export function createHarperLinter() {
  return linter(
    async (view): Promise<Diagnostic[]> => {
      const h = host;
      if (!h) return [];
      const path = h.getActivePath() ?? "";
      if (!/\.(tex|ltx|latex|md|markdown|typ)$/i.test(path)) return [];
      let workerDiagnostics: Diagnostic[] | null = null;
      try {
        workerDiagnostics = await proofreadWithWorker(
          h,
          view,
          "grammar",
        );
      } catch {
        // Fall through to the local grammar provider when the worker is
        // unavailable or a request is interrupted during project switching.
      }
      if (workerDiagnostics) return workerDiagnostics;
      try {
        if (!h.lintGrammar) {
          return localGrammarFallback(view.state.doc.toString(), path, h);
        }
        const projectId = h.getProjectId();
        const { showRegionalism, showWordChoice } = h.getLintPrefs();
        const text = view.state.doc.toString();
        // Guard: masking + WASM grammar linting both run on the main thread, so
        // on a very large document they would jank the editor after the debounce.
        // Skip the pass above a generous cap (covers normal single-file docs).
        if (text.length > MAX_GRAMMAR_CHARS) {
          return localGrammarFallback(text, path, h);
        }
        // Lint compacted prose (no masking gaps), then map spans back to the doc.
        const { prose, map } = /\.(?:md|markdown)$/i.test(path)
          ? markdownToProse(text)
          : maskToProse(text);
        const diags = await h.lintGrammar(prose, prose.length);
        const out: Diagnostic[] = [];
        for (const d of diags) {
          // Category mutes from Settings (e.g. hide all regionalism/word-choice).
          if (!showRegionalism && /regional/i.test(d.kind)) continue;
          if (!showWordChoice && /word.?choice/i.test(d.kind)) continue;
          if (d.from >= map.length) continue;
          const from = map[d.from];
          const to = (map[Math.min(d.to, map.length) - 1] ?? from) + 1;
          if (to <= from) continue;
          const word = text.slice(from, to);
          if (h.isWordIgnored(projectId, word)) continue;
          // regionalism ("Spanner"), word choice, or any style suggestion.
          out.push(
            proofreadingDiagnostic(h, projectId, word, d.suggestions, {
              from,
              to,
              severity: "warning",
              message: d.message,
            }),
          );
        }
        return out;
      } catch {
        return localGrammarFallback(view.state.doc.toString(), path, h);
      }
    },
    // Idle-friendly: wait until typing pauses so Harper WASM does not fight
    // CodeMirror for the main thread mid-keystroke.
    { delay: 900, needsRefresh, tooltipFilter: noLintTooltip }
  );
}

export const spellLintExtensions = (opts: { spell?: boolean; harper?: boolean } = {}) => {
  const exts = [];
  if (opts.spell || opts.harper) {
    exts.push(
      // The card replaces the stock gutter tooltip for the diagnostics it owns.
      lintGutter({ tooltipFilter: noLintTooltip }),
      // Absolute tooltips are clipped by the editor pane and painted under the
      // preview beside it; a fixed tooltip escapes both.
      tooltips({ position: "fixed", parent: document.body }),
      diagnosticCardTooltip(),
      diagnosticCardGutter(),
    );
  }
  // Harper covers spelling too, so only run the standalone Hunspell speller when
  if (opts.spell && !opts.harper) exts.push(createSpellLinter());
  if (opts.harper) exts.push(createHarperLinter());
  return exts;
};
