import { useEffect } from "react";
import { fontFamilyName, primaryFontFamily, quotedFontFamily } from "@/lib/font-families";

export const APP_FONT_STORAGE_KEY = "oleafly.appFont";
export const APP_FONT_SIZE_STORAGE_KEY = "oleafly.appFontSize";

export function applyAppTypography(
  fontFamily: string,
  fontSize: number,
  root: HTMLElement = document.documentElement,
): void {
  root.style.fontSize = `${fontSize}px`;
  const font = fontFamilyName(fontFamily);
  if (font) root.style.setProperty("--app-font", quotedFontFamily(font));
  else root.style.removeProperty("--app-font");
}

function storedValue(key: string): string {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

export function storedAppTypography(): { fontFamily: string; fontSize: number } {
  const font = storedValue(APP_FONT_STORAGE_KEY);
  return {
    fontFamily: font.includes(",") ? primaryFontFamily(font) : fontFamilyName(font),
    fontSize: Number(storedValue(APP_FONT_SIZE_STORAGE_KEY)) || 16,
  };
}

function applyStoredAppTypography(): void {
  const { fontFamily, fontSize } = storedAppTypography();
  applyAppTypography(fontFamily, fontSize);
}

export function useStoredAppTypography(): void {
  useEffect(() => {
    applyStoredAppTypography();
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === APP_FONT_STORAGE_KEY || event.key === APP_FONT_SIZE_STORAGE_KEY) {
        applyStoredAppTypography();
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
}

export function StoredAppTypography(): null {
  useStoredAppTypography();
  return null;
}
