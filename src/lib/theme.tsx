import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

type Theme = "light" | "dark";
type ThemePreference = Theme | "system";

interface ThemeContextValue {
  /** Resolved palette actually applied to the document. */
  theme: Theme;
  /** What the user chose: an explicit palette, or following the OS. */
  preference: ThemePreference;
  setTheme: (theme: Theme) => void;
  setPreference: (preference: ThemePreference) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

const STORAGE_KEY = "oleafly.theme";
const DARK_QUERY = "(prefers-color-scheme: dark)";

function systemTheme(): Theme {
  if (typeof window === "undefined" || !window.matchMedia) return "dark";
  return window.matchMedia(DARK_QUERY).matches ? "dark" : "light";
}

export function getInitialPreference(): ThemePreference {
  if (typeof window === "undefined") return "system";
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === "light" || stored === "dark") return stored;
  return "system";
}

export function getInitialTheme(): Theme {
  const preference = getInitialPreference();
  return preference === "system" ? systemTheme() : preference;
}

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.classList.remove("light", "dark");
  root.classList.add(theme);
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] =
    useState<ThemePreference>(getInitialPreference);
  const [theme, setThemeState] = useState<Theme>(getInitialTheme);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, preference);
    if (preference !== "system") {
      setThemeState(preference);
      return;
    }
    setThemeState(systemTheme());
    if (!window.matchMedia) return;
    const media = window.matchMedia(DARK_QUERY);
    const onChange = (event: { matches: boolean }) => {
      setThemeState(event.matches ? "dark" : "light");
    };
    media.addEventListener("change", onChange);
    return () => {
      media.removeEventListener("change", onChange);
    };
  }, [preference]);

  // Imperative toggle for non-React callers (registry commands, the AI
  // toggle_theme tool): anyone can dispatch this window event.
  useEffect(() => {
    const onToggle = () =>
      setPreferenceState((prev) => {
        const current = prev === "system" ? systemTheme() : prev;
        return current === "dark" ? "light" : "dark";
      });
    window.addEventListener("oleafly:toggle-theme", onToggle);
    return () => {
      window.removeEventListener("oleafly:toggle-theme", onToggle);
    };
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      preference,
      setTheme: setPreferenceState,
      setPreference: setPreferenceState,
      toggleTheme: () =>
        setPreferenceState(theme === "dark" ? "light" : "dark"),
    }),
    [theme, preference]
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
