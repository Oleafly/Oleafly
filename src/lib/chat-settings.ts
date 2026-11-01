import type { EffortLevel, WebToggle } from "@oleafly/ai-core";

export type WebSetting = WebToggle;

export const WEB_ON: WebSetting = Object.freeze({ search: true, fetch: true });

export const WEB_DEFAULT_SUGGESTIONS: ReadonlySet<string> = new Set([
  "literature-sweep",
  "related-work",
  "verify-claims",
]);

export function isWebOn(web: WebSetting | undefined): boolean {
  return Boolean(web && (web.search || web.fetch));
}

export function resolveRunEffort(
  selected: EffortLevel | undefined,
  choices: readonly EffortLevel[],
): EffortLevel | undefined {
  return selected !== undefined && choices.includes(selected) ? selected : undefined;
}

export function runWebTools(web: WebSetting | undefined): WebSetting | undefined {
  return isWebOn(web) ? { search: Boolean(web?.search), fetch: Boolean(web?.fetch) } : undefined;
}
