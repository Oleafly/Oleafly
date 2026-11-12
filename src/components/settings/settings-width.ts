import { createContext, useContext, useLayoutEffect } from "react";
import { useMediaQuery } from "@/lib/media-query";

export const WIDE_SETTINGS_QUERY = "(min-width: 1200px)";

export const SettingsWidthContext = createContext<(wide: boolean) => void>(() => undefined);

export function useRoomySettings(): boolean {
  return useMediaQuery(WIDE_SETTINGS_QUERY);
}

export function useWideSettings(): boolean {
  const roomy = useRoomySettings();
  const setWide = useContext(SettingsWidthContext);
  useLayoutEffect(() => {
    if (!roomy) return;
    setWide(true);
    return () => setWide(false);
  }, [roomy, setWide]);
  return roomy;
}
