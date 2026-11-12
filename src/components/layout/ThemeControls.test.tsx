// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import enShell from "@/i18n/locales/en/shell.json" with { type: "json" };
import { applyTheme, ThemeProvider } from "@/lib/theme";
import { ThemeToggleButton } from "./ThemeControls";

const STORAGE_KEY = "oleafly.theme";

function stubSystemTheme(light: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: () => ({ matches: light, addEventListener: () => undefined, removeEventListener: () => undefined }),
  });
}

function renderToggle() {
  return render(
    <ThemeProvider>
      <ThemeToggleButton />
    </ThemeProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  applyTheme("dark");
});

afterEach(() => {
  Reflect.deleteProperty(window, "matchMedia");
});

describe("ThemeToggleButton", () => {
  it("shows a moon in the light theme and switches to dark", async () => {
    const user = userEvent.setup();
    localStorage.setItem(STORAGE_KEY, "light");
    renderToggle();
    const button = screen.getByRole("button", { name: enShell.commands.theme.toDark });
    expect(button.querySelector("svg.lucide-moon")).toBeInTheDocument();
    await user.click(button);
    expect(localStorage.getItem(STORAGE_KEY)).toBe("dark");
    expect(document.documentElement).toHaveClass("dark");
    const after = screen.getByRole("button", { name: enShell.commands.theme.toLight });
    expect(after.querySelector("svg.lucide-sun")).toBeInTheDocument();
  });

  it("shows a sun in the dark theme and switches to light", async () => {
    const user = userEvent.setup();
    localStorage.setItem(STORAGE_KEY, "dark");
    renderToggle();
    const button = screen.getByRole("button", { name: enShell.commands.theme.toLight });
    expect(button.querySelector("svg.lucide-sun")).toBeInTheDocument();
    await user.click(button);
    expect(localStorage.getItem(STORAGE_KEY)).toBe("light");
    expect(document.documentElement).toHaveClass("light");
    expect(screen.getByRole("button", { name: enShell.commands.theme.toDark })).toBeInTheDocument();
  });

  it("sets the opposite of the theme the system shows, not the system preference", async () => {
    const user = userEvent.setup();
    stubSystemTheme(true);
    renderToggle();
    expect(localStorage.getItem(STORAGE_KEY)).toBe("system");
    await user.click(screen.getByRole("button", { name: enShell.commands.theme.toDark }));
    expect(localStorage.getItem(STORAGE_KEY)).toBe("dark");
    expect(document.documentElement).toHaveClass("dark");
  });
});
