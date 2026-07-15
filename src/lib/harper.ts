import type { LocalLinter, Lint, Span, Suggestion } from "harper.js";
import { logError } from "@/lib/log";

// Harper grammar/style checking (offline, WASM). `harper.js` has no LaTeX
//
// The WASM binary is dynamically imported on first use so the large inlined

let linterPromise: Promise<LocalLinter> | null = null;

export function getGrammarLinter(): Promise<LocalLinter> {
  if (!linterPromise) {
    linterPromise = (async () => {
      const { LocalLinter: LL } = await import("harper.js");
      const { binaryInlined } = await import("harper.js/binaryInlined");
      const l: LocalLinter = new LL({
        binary: binaryInlined as unknown as never,
      });
      await l.setup();
      // Disable rules that are noise for LaTeX prose. Whitespace/formatting
      // rules fire on the gaps that masking leaves behind; dash rules flag
      // LaTeX's own `--`/`---` en/em dashes; and sentence-length/capitalization
      // misfire on the pseudo-sentences that masking creates. Word-level
      // spelling and grammar stay on.
      try {
        await l.setLintConfig({
          Spaces: false,
          NoFrenchSpaces: false,
          TransposedSpace: false,
          Dashes: false,
          NumericRangeEnDash: false,
          LongSentences: false,
          SentenceCapitalization: false,
        });
      } catch {
      }
      return l;
    })();
    // Reset on failure so a later attempt can retry.
    linterPromise.catch((e) => {
      void logError("harper init", e);
      linterPromise = null;
    });
  }
  return linterPromise;
}

export interface GrammarSuggestion {
  text: string;
  // 0 = Replace, 1 = Remove, 2 = InsertAfter (Harper's SuggestionKind).
  kind: number;
}

export interface GrammarDiag {
  from: number;
  to: number;
  message: string;
  kind: string;
  suggestions: GrammarSuggestion[];
}

export async function lintGrammar(
  maskedText: string,
  maxLen: number
): Promise<GrammarDiag[]> {
  const linter = await getGrammarLinter();
  const lints: Lint[] = await linter.lint(maskedText, { language: "plaintext" });
  const out: GrammarDiag[] = [];
  for (const l of lints) {
    let span: Span | null = null;
    let sugs: Suggestion[] = [];
    try {
      span = l.span();
      const from = Math.max(0, Math.min(span.start, maxLen));
      const to = Math.min(Math.max(span.end, from + 1), maxLen);
      if (to <= from) continue;
      sugs = l.suggestions();
      const suggestions: GrammarSuggestion[] = [];
      for (const s of sugs) {
        const text = s.get_replacement_text();
        if (text.length === 0 && s.kind() !== 1) continue;
        suggestions.push({ text, kind: s.kind() });
      }
      out.push({
        from,
        to,
        message: l.message(),
        kind: l.lint_kind(),
        suggestions,
      });
    } catch {
      /* skip a malformed lint */
    } finally {
      sugs.forEach((s) => {
        try {
          s.free();
        } catch {
          /* ignore */
        }
      });
      try {
        span?.free();
      } catch {
        /* ignore */
      }
      try {
        l.free();
      } catch {
        /* ignore */
      }
    }
  }
  return out;
}
