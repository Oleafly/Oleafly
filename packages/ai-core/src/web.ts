export interface WebToggle {
  search: boolean;
  fetch: boolean;
}

export type WebMode = "native" | "local" | "unavailable";

export interface WebSupport {
  search: WebMode;
  fetch: WebMode;
  searchProvider: "brave" | "tavily" | "serper" | null;
}
