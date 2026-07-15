import {
  linter,
  lintGutter,
  forceLinting,
  type Diagnostic,
  type Action,
} from "@codemirror/lint";
import { StateEffect } from "@codemirror/state";
import type { EditorView, ViewUpdate } from "@codemirror/view";

import { maskToProse, spellcheckRanges } from "./latex-mask";
import { markdownSpellcheckRanges, markdownToProse } from "./markdown-mask";

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
  getLintPrefs(): { showRegionalism: boolean; showWordChoice: boolean };
  getSpellchecker(): Promise<{ spell(word: string): boolean }>;
  isSessionIgnored(word: string): boolean;
  isWordIgnored(projectId: string | null, word: string): boolean;
  ignoreWordForProject(projectId: string, word: string): void;
  ignoreWordGlobally(word: string): void;
  lintGrammar(prose: string, maxLen: number): Promise<GrammarDiag[]>;
}

let host: SpellHost | null = null;
export function setSpellHost(h: SpellHost) {
  host = h;
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

export function createSpellLinter() {
  return linter(
    async (view): Promise<Diagnostic[]> => {
      const h = host;
      if (!h) return [];
      try {
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
              diags.push({
                from: r.from,
                to: r.to,
                severity: "warning",
                message: `Possible misspelling: "${r.word}"`,
                actions: ignoreActions(h, projectId, r.word),
              });
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
    { delay: 700, needsRefresh }
  );
}

function suggestionActions(sugs: GrammarSuggestion[]): Action[] {
  return sugs.slice(0, 4).map<Action>((s) => ({
    name:
      s.kind === 1 ? "Remove" : s.kind === 2 ? `Add “${s.text}”` : `“${s.text}”`,
    apply: (view, from, to) => {
      if (s.kind === 2) {
        view.dispatch({ changes: { from: to, insert: s.text } });
      } else if (s.kind === 1) {
        view.dispatch({ changes: { from, to } });
      } else {
        view.dispatch({ changes: { from, to, insert: s.text } });
      }
    },
  }));
}

const MAX_GRAMMAR_CHARS = 150_000;

export function createHarperLinter() {
  return linter(
    async (view): Promise<Diagnostic[]> => {
      const h = host;
      if (!h) return [];
      const path = h.getActivePath() ?? "";
      if (!/\.(tex|ltx|latex|md|markdown)$/i.test(path)) return [];
      try {
        const projectId = h.getProjectId();
        const { showRegionalism, showWordChoice } = h.getLintPrefs();
        const text = view.state.doc.toString();
        // Guard: masking + WASM grammar linting both run on the main thread, so
        // on a very large document they would jank the editor after the debounce.
        // Skip the pass above a generous cap (covers normal single-file docs).
        if (text.length > MAX_GRAMMAR_CHARS) return [];
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
          const actions = [
            ...suggestionActions(d.suggestions),
            ...ignoreActions(h, projectId, word),
          ];
          out.push({ from, to, severity: "warning", message: d.message, actions });
        }
        return out;
      } catch {
        return [];
      }
    },
    // Idle-friendly: wait until typing pauses so Harper WASM does not fight
    // CodeMirror for the main thread mid-keystroke.
    { delay: 900, needsRefresh }
  );
}

export const spellLintExtensions = (opts: { spell?: boolean; harper?: boolean } = {}) => {
  const exts = [];
  if (opts.spell || opts.harper) exts.push(lintGutter());
  // Harper covers spelling too, so only run the standalone Hunspell speller when
  if (opts.spell && !opts.harper) exts.push(createSpellLinter());
  if (opts.harper) exts.push(createHarperLinter());
  return exts;
};
