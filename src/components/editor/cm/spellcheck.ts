import {
  linter,
  lintGutter,
  forceLinting,
  type Diagnostic,
  type Action,
} from "@codemirror/lint";
import { StateEffect } from "@codemirror/state";
import type { EditorView, ViewUpdate } from "@codemirror/view";
import { useSettingsStore } from "@/store/settings";
import { getSpellchecker, isIgnored } from "@/lib/spellcheck";
import { lintGrammar, type GrammarSuggestion } from "@/lib/harper";
import {
  isWordIgnored,
  ignoreWordForProject,
  ignoreWordGlobally,
} from "@/lib/dictionary";
import { useFilesStore } from "@/store/files";

import { maskToProse, spellcheckRanges } from "./latex-mask";

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

/**
 * Re-run the linters now (used when the ignore dictionary or lint-category
 * settings change from outside the editor, e.g. the Settings dialog).
 */
export function refreshEditorLints(view: EditorView | null): void {
  if (!view) return;
  view.dispatch({ effects: refreshLints.of(null) });
  forceLinting(view);
}

/**
 * Tooltip actions to dismiss any warning for the flagged word/phrase — either
 * for this project only or everywhere. Works for every lint kind (spelling,
 * regionalism like "Spanner", word choice, …), not just spelling.
 */
function ignoreActions(projectId: string | null, word: string): Action[] {
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
        ignoreWordForProject(projectId, word);
        refresh(view);
      },
    });
  }
  actions.push({
    name: `Ignore “${short}” everywhere`,
    apply: (view) => {
      ignoreWordGlobally(word);
      refresh(view);
    },
  });
  return actions;
}

/** A CM6 linter that underlines misspelled words (debounced). */
export function createSpellLinter() {
  return linter(
    async (view): Promise<Diagnostic[]> => {
      try {
        const hunspell = await getSpellchecker();
        const projectId = useFilesStore.getState().projectId;
        const ranges = spellcheckRanges(view.state.doc.toString());
        const diags: Diagnostic[] = [];
        for (const r of ranges) {
          if (r.word.length < 2 || isIgnored(r.word)) continue;
          if (isWordIgnored(projectId, r.word)) continue;
          try {
            if (!hunspell.spell(r.word)) {
              diags.push({
                from: r.from,
                to: r.to,
                severity: "warning",
                message: `Possible misspelling: "${r.word}"`,
                actions: ignoreActions(projectId, r.word),
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
    { delay: 500, needsRefresh }
  );
}

/** Build CodeMirror lint actions from Harper suggestions (click-to-fix). */
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

/**
 * A CM6 linter that runs Harper's spelling + grammar/style checks. Only active
 * on `.tex` files, and only over prose (see `maskLatex`) so code and math are
 * never flagged. Harper owns spelling here (its dictionary handles technical
 * terms like "Kubernetes"/"gRPC" that plain Hunspell trips on), so every lint
 * kind is surfaced. Spelling warnings get an "Ignore in this project" action so
 * proper nouns and identifiers (e.g. "L5") can be dismissed for good. Loads WASM
 * lazily.
 */
/** Above this document size, skip the main-thread grammar pass to avoid jank.
 *  Most single `.tex` files are well under this; book-length files exceed it. */
const MAX_GRAMMAR_CHARS = 150_000;

export function createHarperLinter() {
  return linter(
    async (view): Promise<Diagnostic[]> => {
      const path = useFilesStore.getState().activePath ?? "";
      // Prose checking only for LaTeX; leave .sty/.cls/etc. alone.
      if (!/\.tex$/i.test(path)) return [];
      try {
        const projectId = useFilesStore.getState().projectId;
        const { showRegionalism, showWordChoice } = useSettingsStore.getState();
        const text = view.state.doc.toString();
        // Guard: masking + WASM grammar linting both run on the main thread, so
        // on a very large document they would jank the editor after the debounce.
        // Skip the pass above a generous cap (covers normal single-file docs).
        if (text.length > MAX_GRAMMAR_CHARS) return [];
        // Lint compacted prose (no masking gaps), then map spans back to the doc.
        const { prose, map } = maskToProse(text);
        const diags = await lintGrammar(prose, prose.length);
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
          if (isWordIgnored(projectId, word)) continue;
          // Every warning can be dismissed for the flagged word/phrase — spelling,
          // regionalism ("Spanner"), word choice, or any style suggestion.
          const actions = [
            ...suggestionActions(d.suggestions),
            ...ignoreActions(projectId, word),
          ];
          out.push({ from, to, severity: "warning", message: d.message, actions });
        }
        return out;
      } catch {
        return [];
      }
    },
    { delay: 450, needsRefresh }
  );
}

export const spellLintExtensions = (opts: { spell?: boolean; harper?: boolean } = {}) => {
  const exts = [];
  if (opts.spell || opts.harper) exts.push(lintGutter());
  // Harper covers spelling too, so only run the standalone Hunspell speller when
  // Harper is off — otherwise every misspelling would be underlined twice.
  if (opts.spell && !opts.harper) exts.push(createSpellLinter());
  if (opts.harper) exts.push(createHarperLinter());
  return exts;
};
