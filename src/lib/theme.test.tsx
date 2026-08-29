// @vitest-environment jsdom

import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeProvider, useTheme } from "./theme";

type Listener = (event: { matches: boolean }) => void;

function installMatchMedia(initialDark: boolean) {
  let dark = initialDark;
  const listeners = new Set<Listener>();
  window.matchMedia = vi.fn((query: string) => ({
    get matches() {
      return query.includes("dark") ? dark : !dark;
    },
    media: query,
    addEventListener: (_type: string, listener: Listener) => {
      listeners.add(listener);
    },
    removeEventListener: (_type: string, listener: Listener) => {
      listeners.delete(listener);
    },
  })) as unknown as typeof window.matchMedia;
  return {
    setOsDark(next: boolean) {
      dark = next;
      for (const listener of listeners) listener({ matches: next });
    },
  };
}

function Probe() {
  const { theme, preference } = useTheme();
  return (
    <p>
      {theme}:{preference}
    </p>
  );
}

describe("ThemeProvider", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.className = "";
    document.documentElement.removeAttribute("data-theme");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("follows the OS palette when no preference is stored", () => {
    installMatchMedia(false);
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );

    expect(screen.getByText("light:system")).toBeInTheDocument();
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(document.documentElement.classList.contains("light")).toBe(true);
  });

  it("applies a stored explicit preference over the OS palette", () => {
    installMatchMedia(false);
    window.localStorage.setItem("oleafly.theme", "dark");
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );

    expect(screen.getByText("dark:dark")).toBeInTheDocument();
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("tracks live OS palette changes while the preference is system", () => {
    const media = installMatchMedia(false);
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );

    act(() => media.setOsDark(true));

    expect(screen.getByText("dark:system")).toBeInTheDocument();
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("stops tracking the OS once an explicit theme is chosen", () => {
    const media = installMatchMedia(false);
    function Chooser() {
      const { setTheme } = useTheme();
      return (
        <button type="button" onClick={() => setTheme("light")}>
          choose light
        </button>
      );
    }
    render(
      <ThemeProvider>
        <Probe />
        <Chooser />
      </ThemeProvider>,
    );

    act(() => screen.getByText("choose light").click());
    act(() => media.setOsDark(true));

    expect(screen.getByText("light:light")).toBeInTheDocument();
    expect(window.localStorage.getItem("oleafly.theme")).toBe("light");
  });

  it("can return to following the OS via the system preference", () => {
    installMatchMedia(true);
    window.localStorage.setItem("oleafly.theme", "light");
    function Chooser() {
      const { setPreference } = useTheme();
      return (
        <button type="button" onClick={() => setPreference("system")}>
          follow system
        </button>
      );
    }
    render(
      <ThemeProvider>
        <Probe />
        <Chooser />
      </ThemeProvider>,
    );

    act(() => screen.getByText("follow system").click());

    expect(screen.getByText("dark:system")).toBeInTheDocument();
    expect(window.localStorage.getItem("oleafly.theme")).toBe("system");
  });
});
