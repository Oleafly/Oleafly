import type { CollabSuggestion, CollabSuggestionList, CollabSuggestionsChanged } from "@/lib/tauri";
import { BOB_ID } from "./fixtures";

export const SUGGESTED_AT = 1_760_000_000_000;

export function suggestion(id: string, overrides: Partial<CollabSuggestion> = {}): CollabSuggestion {
  return {
    id,
    fileId: "file-intro",
    kind: "insert",
    author: BOB_ID,
    createdAt: SUGGESTED_AT,
    from: 4,
    to: 10,
    text: "quick ",
    threadId: null,
    verified: true,
    ...overrides,
  };
}

export function suggestionList(suggestions: CollabSuggestion[], rev: number | null = null): CollabSuggestionList {
  return { rev, suggestions };
}

export function suggestionsChanged(overrides: Partial<CollabSuggestionsChanged> = {}): CollabSuggestionsChanged {
  return { projectId: "paper", paths: ["intro.tex"], local: false, ...overrides };
}
