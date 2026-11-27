import { beforeEach, describe, expect, it, vi } from "vitest";
import { SECTION_SETTINGS, sectionDiffersFromDefaults, useSettingsStore } from "./settings";

async function restart(values: Record<string, string> = {}) {
  for (const [key, value] of Object.entries(values)) localStorage.setItem(key, value);
  vi.resetModules();
  return (await import("./settings")).useSettingsStore.getState();
}

beforeEach(() => {
  localStorage.clear();
  useSettingsStore.getState().resetToDefaults();
});

describe("snippet preferences", () => {
  it("starts with every way to fire a snippet on and no tips shown", async () => {
    expect(await restart()).toMatchObject({
      snippetsInList: true,
      snippetsTab: true,
      snippetsAuto: true,
      snippetsHint: true,
      snippetAutoNoteShown: false,
      snippetFastMathTipShown: false,
    });
  });

  it("keeps each choice across a restart", async () => {
    const settings = useSettingsStore.getState();
    settings.setSnippetsInList(false);
    settings.setSnippetsTab(false);
    settings.setSnippetsAuto(false);
    settings.setSnippetsHint(false);
    settings.setSnippetAutoNoteShown(true);
    settings.setSnippetFastMathTipShown(true);
    expect(localStorage.getItem("oleafly.snippets.list")).toBe("0");
    expect(await restart()).toMatchObject({
      snippetsInList: false,
      snippetsTab: false,
      snippetsAuto: false,
      snippetsHint: false,
      snippetAutoNoteShown: true,
      snippetFastMathTipShown: true,
    });
  });

  it("resets the four switches as the Snippets section, leaving the one-time tips alone", () => {
    expect(SECTION_SETTINGS.snippets).toEqual({
      snippetsInList: "oleafly.snippets.list",
      snippetsTab: "oleafly.snippets.tab",
      snippetsAuto: "oleafly.snippets.auto",
      snippetsHint: "oleafly.snippets.hint",
    });
    const settings = useSettingsStore.getState();
    expect(sectionDiffersFromDefaults("snippets", useSettingsStore.getState())).toBe(false);
    settings.setSnippetsAuto(false);
    settings.setSnippetFastMathTipShown(true);
    expect(sectionDiffersFromDefaults("snippets", useSettingsStore.getState())).toBe(true);
    settings.resetSnippetsPreferences();
    expect(useSettingsStore.getState()).toMatchObject({ snippetsAuto: true, snippetFastMathTipShown: true });
    expect(localStorage.getItem("oleafly.snippets.auto")).toBe("1");
    settings.setSnippetsHint(false);
    settings.resetToDefaults();
    expect(useSettingsStore.getState().snippetsHint).toBe(true);
  });
});
