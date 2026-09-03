// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyPreference,
  applyTheme,
  currentTheme,
  getInitialTheme,
  getStoredPreference,
  requestThemePreference,
  requestThemeToggle,
  subscribeTheme,
  ThemeProvider,
  useTheme,
} from "./theme";

type MediaListener = (event: { matches: boolean }) => void;

function stubMatchMedia(light: boolean) {
  const listeners = new Set<MediaListener>();
  const query = {
    matches: light,
    addEventListener: (_type: string, listener: MediaListener) => {
      listeners.add(listener);
    },
    removeEventListener: (_type: string, listener: MediaListener) => {
      listeners.delete(listener);
    },
  };
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: () => query,
  });
  return {
    change(matches: boolean) {
      query.matches = matches;
      for (const listener of [...listeners]) listener({ matches });
    },
    listenerCount: () => listeners.size,
  };
}

const renderTheme = () => renderHook(() => useTheme(), { wrapper: ThemeProvider });

beforeEach(() => {
  localStorage.clear();
  applyTheme("dark");
});

afterEach(() => {
  Reflect.deleteProperty(window, "matchMedia");
});

describe("theme preference storage", () => {
  it("treats an empty store as the system preference", () => {
    expect(getStoredPreference()).toBe("system");
  });

  it("keeps a stored light or dark preference", () => {
    localStorage.setItem("oleafly.theme", "light");
    expect(getStoredPreference()).toBe("light");
    localStorage.setItem("oleafly.theme", "dark");
    expect(getStoredPreference()).toBe("dark");
  });

  it("reads a stored system value and unknown values as system", () => {
    localStorage.setItem("oleafly.theme", "system");
    expect(getStoredPreference()).toBe("system");
    localStorage.setItem("oleafly.theme", "sepia");
    expect(getStoredPreference()).toBe("system");
  });
});

describe("theme resolution", () => {
  it("falls back to dark when matchMedia is unavailable", () => {
    expect(getInitialTheme()).toBe("dark");
  });

  it("follows the operating system when nothing is stored", () => {
    stubMatchMedia(true);
    expect(getInitialTheme()).toBe("light");
  });

  it("lets a stored preference win over the operating system", () => {
    stubMatchMedia(true);
    localStorage.setItem("oleafly.theme", "dark");
    expect(getInitialTheme()).toBe("dark");
  });
});

describe("theme store", () => {
  it("applies the root class and color scheme without touching storage", () => {
    applyTheme("light");
    expect(document.documentElement.classList.contains("light")).toBe(true);
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(document.documentElement.style.colorScheme).toBe("light");
    expect(localStorage.getItem("oleafly.theme")).toBeNull();
    expect(currentTheme()).toBe("light");
  });

  it("persists a preference and applies the theme it resolves to", () => {
    stubMatchMedia(true);
    expect(applyPreference("system")).toBe("light");
    expect(localStorage.getItem("oleafly.theme")).toBe("system");
    expect(currentTheme()).toBe("light");
    expect(applyPreference("dark")).toBe("dark");
    expect(localStorage.getItem("oleafly.theme")).toBe("dark");
    expect(currentTheme()).toBe("dark");
  });

  it("notifies subscribers only when the resolved theme changes", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeTheme(listener);
    applyTheme("dark");
    expect(listener).not.toHaveBeenCalled();
    applyTheme("light");
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith("light");
    unsubscribe();
    applyTheme("dark");
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe("ThemeProvider", () => {
  it("resolves the system preference from the operating system and follows it live", () => {
    const media = stubMatchMedia(false);
    const resolved = vi.fn();
    const unsubscribe = subscribeTheme(resolved);
    const { result } = renderTheme();

    expect(result.current.preference).toBe("system");
    expect(result.current.theme).toBe("dark");
    expect(media.listenerCount()).toBe(1);

    act(() => media.change(true));
    expect(result.current.preference).toBe("system");
    expect(result.current.theme).toBe("light");
    expect(document.documentElement.classList.contains("light")).toBe(true);
    expect(document.documentElement.style.colorScheme).toBe("light");
    expect(resolved).toHaveBeenLastCalledWith("light");
    expect(localStorage.getItem("oleafly.theme")).toBe("system");
    unsubscribe();
  });

  it("stops following the operating system once an explicit preference is set", () => {
    const media = stubMatchMedia(false);
    const { result } = renderTheme();

    act(() => result.current.setPreference("dark"));
    expect(media.listenerCount()).toBe(0);
    expect(localStorage.getItem("oleafly.theme")).toBe("dark");

    act(() => media.change(true));
    expect(result.current.theme).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("removes the media listener on unmount", () => {
    const media = stubMatchMedia(false);
    const { unmount } = renderTheme();
    expect(media.listenerCount()).toBe(1);
    unmount();
    expect(media.listenerCount()).toBe(0);
  });

  it("toggles from system to the explicit opposite of the resolved theme", () => {
    stubMatchMedia(true);
    const { result } = renderTheme();
    expect(result.current.theme).toBe("light");

    act(() => result.current.toggleTheme());
    expect(result.current.preference).toBe("dark");
    expect(result.current.theme).toBe("dark");
    expect(localStorage.getItem("oleafly.theme")).toBe("dark");

    act(() => result.current.toggleTheme());
    expect(result.current.preference).toBe("light");
    expect(result.current.theme).toBe("light");
  });

  it("answers the window events used by commands and the AI tool", () => {
    stubMatchMedia(false);
    const { result } = renderTheme();

    act(() => requestThemeToggle());
    expect(result.current.preference).toBe("light");

    act(() => requestThemePreference("system"));
    expect(result.current.preference).toBe("system");
    expect(result.current.theme).toBe("dark");

    act(() => {
      window.dispatchEvent(
        new CustomEvent("oleafly:set-theme-preference", { detail: "sepia" }),
      );
    });
    expect(result.current.preference).toBe("system");
  });

  it("reports only resolved themes to subscribers", () => {
    const media = stubMatchMedia(false);
    const seen: string[] = [];
    const unsubscribe = subscribeTheme((theme) => {
      seen.push(theme);
    });
    const { result } = renderTheme();

    act(() => result.current.setPreference("light"));
    act(() => result.current.setPreference("system"));
    act(() => media.change(true));
    act(() => result.current.setPreference("dark"));

    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((theme) => theme === "light" || theme === "dark")).toBe(true);
    unsubscribe();
  });
});
