import {
  snippet,
  type Completion,
  type CompletionSource,
} from "@codemirror/autocomplete";
import {
  createCompletionRequestGuard,
  guardCompletionForSource,
  scanMathExpressions,
} from "@oleafly/editor";
import {
  loadAtSuggestions,
  type AtSuggestion,
} from "@oleafly/latex-intelligence";

const MATH_WINDOW = 2048;

const AT_TOKEN = /@[A-Za-z()[\]{}|<>+\-*=.]*$/;

export function isMathContext(text: string, pos: number): boolean {
  const from = Math.max(0, Math.min(pos, text.length) - MATH_WINDOW);
  const to = Math.min(text.length, pos + MATH_WINDOW);
  const local = pos - from;
  for (const expression of scanMathExpressions(text.slice(from, to), {
    format: "latex",
  })) {
    if (expression.bodyFrom > local) break;
    if (local >= expression.bodyFrom && local <= expression.bodyTo) return true;
  }
  return false;
}

let cachedSuggestions: AtSuggestion[] | null = null;
let cachedOptions: Completion[] | null = null;
let loadRequested = false;

export function warmAtSuggestions(): void {
  if (loadRequested) return;
  loadRequested = true;
  void loadAtSuggestions().then((value) => {
    cachedSuggestions = value;
  });
}

export function setAtSuggestionsForTest(value: AtSuggestion[] | null): void {
  cachedSuggestions = value;
  cachedOptions = null;
  loadRequested = value !== null;
}

function baseOptions(suggestions: AtSuggestion[]): Completion[] {
  cachedOptions ??= suggestions.map((suggestion) => ({
    label: suggestion.trigger,
    type: "keyword",
    ...(suggestion.detail === undefined ? {} : { detail: suggestion.detail }),
    apply: snippet(suggestion.replacement),
  }));
  return cachedOptions;
}

export const atSuggestionCompletion: CompletionSource = (context) => {
  const token = context.matchBefore(AT_TOKEN);
  if (!token) return null;
  if (!isMathContext(context.state.doc.toString(), context.pos)) return null;
  const suggestions = cachedSuggestions;
  if (!suggestions) {
    warmAtSuggestions();
    return null;
  }
  const guard = createCompletionRequestGuard(context);
  return {
    from: token.from,
    options: baseOptions(suggestions).map((option) =>
      guardCompletionForSource(guard, option),
    ),
  };
};
