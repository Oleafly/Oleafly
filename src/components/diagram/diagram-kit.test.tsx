// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const theme = vi.hoisted(() => ({ current: "light" as "light" | "dark" }));

vi.mock("@/lib/theme", () => ({
  useTheme: () => ({ theme: theme.current }),
}));

import { useSettingsStore } from "@/store/settings";
import { KIT } from "./diagram-kit";

beforeEach(() => {
  theme.current = "light";
  useSettingsStore.setState({ accentColor: "#2563eb" });
});

describe("the diagram kit", () => {
  it("reports the app theme as the composer's mode", () => {
    const { result, rerender } = renderHook(() => KIT.useThemeMode());
    expect(result.current).toBe("light");

    theme.current = "dark";
    rerender();

    expect(result.current).toBe("dark");
  });

  it("follows the accent color setting", () => {
    const { result, rerender } = renderHook(() => KIT.usePrimaryColor());
    expect(result.current).toBe("#2563eb");

    useSettingsStore.setState({ accentColor: "#0d9488" });
    rerender();

    expect(result.current).toBe("#0d9488");
  });
});
