// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyTheme, currentTheme, getInitialTheme, subscribeTheme } from "./theme";

describe("theme initialization", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("defaults new installs to dark", () => {
    expect(getInitialTheme()).toBe("dark");
  });

  it("keeps a saved theme preference", () => {
    localStorage.setItem("oleafly.theme", "light");
    expect(getInitialTheme()).toBe("light");
  });
});

describe("theme store", () => {
  beforeEach(() => {
    localStorage.clear();
    applyTheme("dark");
  });

  it("applies the root class, color scheme, and storage in one step", () => {
    applyTheme("light");
    expect(document.documentElement.classList.contains("light")).toBe(true);
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(document.documentElement.style.colorScheme).toBe("light");
    expect(localStorage.getItem("oleafly.theme")).toBe("light");
    expect(currentTheme()).toBe("light");
  });

  it("notifies subscribers only when the theme actually changes", () => {
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
