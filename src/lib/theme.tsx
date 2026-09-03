import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type Theme = "light" | "dark";
export type ThemePreference = "system" | "light" | "dark";

interface ThemeContextValue {
  preference: ThemePreference;
  theme: Theme;
  setPreference: (preference: ThemePreference) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

const STORAGE_KEY = "oleafly.theme";
const LIGHT_SCHEME_QUERY = "(prefers-color-scheme: light)";

export const TOGGLE_THEME_EVENT = "oleafly:toggle-theme";
export const SET_THEME_PREFERENCE_EVENT = "oleafly:set-theme-preference";

type ThemeListener = (theme: Theme) => void;

const listeners = new Set<ThemeListener>();
let appliedTheme: Theme | null = null;

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === "system" || value === "light" || value === "dark";
}

export function getStoredPreference(): ThemePreference {
  if (typeof window === "undefined") return "system";
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored === "light" || stored === "dark" ? stored : "system";
}

function lightSchemeQuery(): MediaQueryList | null {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return null;
  return window.matchMedia(LIGHT_SCHEME_QUERY);
}

export function systemTheme(): Theme {
  return lightSchemeQuery()?.matches ? "light" : "dark";
}

export function resolveTheme(preference: ThemePreference): Theme {
  return preference === "system" ? systemTheme() : preference;
}

export function getInitialTheme(): Theme {
  return resolveTheme(getStoredPreference());
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
  const changed = appliedTheme !== theme;
  appliedTheme = theme;
  if (!changed) return;
  for (const listener of [...listeners]) listener(theme);
}

export function applyPreference(preference: ThemePreference): Theme {
  window.localStorage.setItem(STORAGE_KEY, preference);
  const theme = resolveTheme(preference);
  applyTheme(theme);
  return theme;
}

export function requestThemePreference(preference: ThemePreference): void {
  window.dispatchEvent(new CustomEvent(SET_THEME_PREFERENCE_EVENT, { detail: preference }));
}

export function requestThemeToggle(): void {
  window.dispatchEvent(new CustomEvent(TOGGLE_THEME_EVENT));
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreference] = useState<ThemePreference>(getStoredPreference);
  const [theme, setTheme] = useState<Theme>(() => resolveTheme(preference));

  useLayoutEffect(() => {
    setTheme(applyPreference(preference));
    if (preference !== "system") return;
    const query = lightSchemeQuery();
    if (!query || typeof query.addEventListener !== "function") return;
    const onChange = (event: MediaQueryListEvent) => {
      const next: Theme = event.matches ? "light" : "dark";
      applyTheme(next);
      setTheme(next);
    };
    query.addEventListener("change", onChange);
    return () => {
      query.removeEventListener("change", onChange);
    };
  }, [preference]);

  const toggleTheme = useCallback(() => {
    setPreference(currentTheme() === "dark" ? "light" : "dark");
  }, []);

  useEffect(() => {
    const onToggle = () => toggleTheme();
    const onSet = (event: Event) => {
      const detail = event instanceof CustomEvent ? event.detail : undefined;
      if (isThemePreference(detail)) setPreference(detail);
    };
    window.addEventListener(TOGGLE_THEME_EVENT, onToggle);
    window.addEventListener(SET_THEME_PREFERENCE_EVENT, onSet);
    return () => {
      window.removeEventListener(TOGGLE_THEME_EVENT, onToggle);
      window.removeEventListener(SET_THEME_PREFERENCE_EVENT, onSet);
    };
  }, [toggleTheme]);

  const value = useMemo<ThemeContextValue>(
    () => ({ preference, theme, setPreference, toggleTheme }),
    [preference, theme, toggleTheme],
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
