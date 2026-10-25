// Per-chat effort and web settings, and how they become request fields.
import type { EffortLevel, WebToggle } from "@oleafly/ai-core";

export type WebSetting = WebToggle;

export const WEB_ON: WebSetting = Object.freeze({ search: true, fetch: true });

/** Quick starts that open a new chat with web access on. */
export const WEB_DEFAULT_SUGGESTIONS: ReadonlySet<string> = new Set([
  "literature-sweep",
  "related-work",
  "verify-claims",
]);

export function isWebOn(web: WebSetting | undefined): boolean {
  return Boolean(web && (web.search || web.fetch));
}

/**
 * The effort a run sends: the chat's choice when the model offers it,
 * nothing for Auto or for a level the model does not take.
 */
export function resolveRunEffort(
  selected: EffortLevel | undefined,
  choices: readonly EffortLevel[],
): EffortLevel | undefined {
  return selected !== undefined && choices.includes(selected) ? selected : undefined;
}

/** The web tools a run asks for; nothing when web is off. */
export function runWebTools(web: WebSetting | undefined): WebSetting | undefined {
  return isWebOn(web) ? { search: Boolean(web?.search), fetch: Boolean(web?.fetch) } : undefined;
}
