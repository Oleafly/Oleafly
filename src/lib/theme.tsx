import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type Theme = "light" | "dark";

interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

const STORAGE_KEY = "oleafly.theme";

type ThemeListener = (theme: Theme) => void;

const listeners = new Set<ThemeListener>();
let appliedTheme: Theme | null = null;

export function getInitialTheme(): Theme {
  if (typeof window === "undefined") return "dark";
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === "light" || stored === "dark") return stored;
  return "dark";
}

export function currentTheme(): Theme {
  return appliedTheme ?? getInitialTheme();
}

export function subscribeTheme(listener: ThemeListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  root.classList.remove("light", "dark");
  root.classList.add(theme);
  root.style.colorScheme = theme;
  window.localStorage.setItem(STORAGE_KEY, theme);
  const changed = appliedTheme !== theme;
  appliedTheme = theme;
  if (!changed) return;
  for (const listener of [...listeners]) listener(theme);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(getInitialTheme);

  useLayoutEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // Imperative toggle for non-React callers (registry commands, the AI
  // toggle_theme tool): anyone can dispatch this window event.
  useEffect(() => {
    const onToggle = () => setThemeState((prev) => (prev === "dark" ? "light" : "dark"));
    window.addEventListener("oleafly:toggle-theme", onToggle);
    return () => {
      window.removeEventListener("oleafly:toggle-theme", onToggle);
    };
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      setTheme: setThemeState,
      toggleTheme: () =>
        setThemeState((prev) => (prev === "dark" ? "light" : "dark")),
    }),
    [theme]
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
