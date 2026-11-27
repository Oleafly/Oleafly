import type { CollabSuggestion, CollabSuggestionList, CollabSuggestionsChanged } from "@/lib/tauri";
import { type LiveSeed, SERVER_SEED } from "./fixtures";

export const SUGGESTED_AT = 1_760_000_000_000;

export function suggestionFixtures(seed: LiveSeed) {
  const suggestion = (id: string, overrides: Partial<CollabSuggestion> = {}): CollabSuggestion => ({
    id,
    fileId: seed.fileId,
    kind: "insert",
    author: seed.bob.account_id,
    createdAt: SUGGESTED_AT,
    from: 4,
    to: 10,
    text: "quick ",
    threadId: null,
    verified: true,
    ...overrides,
  });
  return { suggestion };
}

export const { suggestion } = suggestionFixtures(SERVER_SEED);

export function suggestionList(
  suggestions: CollabSuggestion[],
  rev: number | null = null,
  canAccept = true,
): CollabSuggestionList {
  return { rev, suggestions, canAccept };
}

export function suggestionsChanged(overrides: Partial<CollabSuggestionsChanged> = {}): CollabSuggestionsChanged {
  return { projectId: "paper", paths: ["intro.tex"], local: false, ...overrides };
}
