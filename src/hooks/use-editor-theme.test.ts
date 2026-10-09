// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { applyTheme } from "@/lib/theme";
import { useSettingsStore } from "@/store/settings";
import { useEditorColorKey, useEditorThemeId } from "./use-editor-theme";

afterEach(() => {
  act(() => applyTheme("light"));
  useSettingsStore.setState({ editorThemeLight: "system", editorThemeDark: "system" });
});

describe("useEditorThemeId", () => {
  it("follows the app between the light and the dark editor theme", () => {
    act(() => applyTheme("light"));
    useSettingsStore.setState({ editorThemeLight: "paper", editorThemeDark: "system" });
    const theme = renderHook(() => useEditorThemeId());
    const key = renderHook(() => useEditorColorKey());
    expect(theme.result.current).toBe("paper");
    expect(key.result.current).toBe("paper");

    act(() => applyTheme("dark"));
    expect(theme.result.current).toBe("system");
    expect(key.result.current).toBe("system-dark");
  });
});
