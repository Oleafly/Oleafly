import "@oleafly/preview/polyfills";

const root = document.documentElement;

if (typeof CSSPropertyRule === "undefined") root.setAttribute("data-tw-property-fallback", "");
root.setAttribute("data-window-surface", "solid");

const dark = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-color-scheme: dark)") : null;

function applyTheme(): void {
  const isDark = dark?.matches === true;
  root.classList.toggle("dark", isDark);
  root.classList.toggle("light", !isDark);
  root.style.colorScheme = isDark ? "dark" : "light";
}

applyTheme();
dark?.addEventListener("change", applyTheme);
