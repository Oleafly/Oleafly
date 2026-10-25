// Web search and fetch for a chat. Mirrors WebTools in
// crates/oleafly-agent/src/complete.rs and WebSupport in
// src-tauri/src/agent/web.rs.

/** What the chat's Web toggle turns on for a run. */
export interface WebToggle {
  search: boolean;
  fetch: boolean;
}

/**
 * `native`: the provider runs the tool itself. `local`: Oleafly runs it
 * (search needs a Brave, Tavily or Serper key). `unavailable`: no way to
 * run it for this model.
 */
export type WebMode = "native" | "local" | "unavailable";

export interface WebSupport {
  search: WebMode;
  fetch: WebMode;
  searchProvider: "brave" | "tavily" | "serper" | null;
}
