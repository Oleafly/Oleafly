import { describe, expect, it } from "vitest";
import {
  AI_TOOL_SETTINGS_STORAGE_KEY,
  createAiToolSettingsStore,
  isToolEnabled,
  selectToolEnabled,
} from "./ai-tool-settings";

function storageFixture() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  };
}

describe("AI tool settings", () => {
  it("defaults unset and newly discovered tools to enabled", () => {
    const store = createAiToolSettingsStore(storageFixture());

    expect(isToolEnabled(store.getState().enabledByName, "read_file")).toBe(true);
    expect(selectToolEnabled("new_server_tool")(store.getState())).toBe(true);
  });

  it("persists an explicit tool choice globally", () => {
    const storage = storageFixture();
    const store = createAiToolSettingsStore(storage);
    store.getState().setToolEnabled("read_file", false);

    const persisted = JSON.parse(String(storage.getItem(AI_TOOL_SETTINGS_STORAGE_KEY)));
    expect(persisted.state.enabledByName).toEqual({ read_file: false });

    const reloaded = createAiToolSettingsStore(storage);
    expect(selectToolEnabled("read_file")(reloaded.getState())).toBe(false);
    expect(selectToolEnabled("tool_added_later")(reloaded.getState())).toBe(true);
  });

  it("changes only the currently available tools in a bulk update", () => {
    const store = createAiToolSettingsStore(storageFixture());
    store.getState().setToolEnabled("temporarily_unavailable", false);
    store.getState().setToolsEnabled(["read_file", "compile"], false);

    expect(store.getState().enabledByName).toEqual({
      temporarily_unavailable: false,
      read_file: false,
      compile: false,
    });

    store.getState().setToolsEnabled(["read_file", "compile"], true);
    expect(selectToolEnabled("read_file")(store.getState())).toBe(true);
    expect(selectToolEnabled("compile")(store.getState())).toBe(true);
    expect(selectToolEnabled("temporarily_unavailable")(store.getState())).toBe(false);
  });
});
