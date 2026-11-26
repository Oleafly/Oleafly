import { beforeEach, describe, expect, it } from "vitest";
import { useSettingsStore } from "@/store/settings";
import { openSnippetSettings, useSnippetSettingsRequest } from "./open-settings";

beforeEach(() => {
  useSettingsStore.getState().setSettingsOpen(false);
  useSnippetSettingsRequest.setState({ recordId: null });
});

describe("openSnippetSettings", () => {
  it("opens Settings on the Snippets section and asks it to open a snippet", () => {
    openSnippetSettings("user.fig");
    expect(useSettingsStore.getState()).toMatchObject({ settingsOpen: true, settingsInitialSection: "snippets" });
    expect(useSnippetSettingsRequest.getState().recordId).toBe("user.fig");
  });

  it("opens the list when no snippet is named", () => {
    openSnippetSettings();
    expect(useSnippetSettingsRequest.getState().recordId).toBeNull();
    expect(useSettingsStore.getState().settingsInitialSection).toBe("snippets");
  });
});
