import type { LocalLinter, Lint, Span, Suggestion } from "harper.js";
import { logError } from "@/lib/log";

let linterPromise: Promise<LocalLinter> | null = null;

export function getGrammarLinter(): Promise<LocalLinter> {
  if (!linterPromise) {
    linterPromise = (async () => {
      const { LocalLinter: LL } = await import("harper.js");
      const { binary } = await import("harper.js/binary");
      const l: LocalLinter = new LL({ binary });
      await l.setup();
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
    linterPromise.catch((e) => {
      void logError("harper init", e);
      linterPromise = null;
    });
  }
  return linterPromise;
}

export interface GrammarSuggestion {
  text: string;
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
    } finally {
      sugs.forEach((s) => {
        try {
          s.free();
        } catch {
        }
      });
      try {
        span?.free();
      } catch {
      }
      try {
        l.free();
      } catch {
      }
    }
  }
  return out;
}
