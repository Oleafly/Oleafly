import { ColorMode, ColorScheme, ThemeLike } from "./types.js";
import { ThemeResolver } from "./createThemeResolver.js";
import { ThemeCatalog } from "./createThemeCatalog.js";

//#region src/modules/createThemeController.d.ts
interface ThemeControllerState {
  darkThemeName: string;
  lightThemeName: string;
  mode: ColorMode;
  pendingThemeResolution?: PendingThemeResolution;
  resolutionError?: ThemeResolutionError;
  resolvedTheme?: ThemeLike;
  resolvedColorScheme: ColorScheme;
}
interface PendingThemeResolution {
  colorScheme: ColorScheme;
  name: string;
}
interface ThemeResolutionError extends PendingThemeResolution {
  error: unknown;
}
type ThemeResolutionErrorContext = PendingThemeResolution;
interface ThemeController {
  resolver: ThemeResolver;
  destroy(): void;
  getState(): ThemeControllerState;
  setColorMode(mode: ColorMode): void;
  setThemeNameForScheme(scheme: ColorScheme, name: string): void;
  subscribe(listener: () => void): () => void;
}
interface ThemeControllerBaseOptions {
  defaultDarkThemeName?: string;
  defaultLightThemeName?: string;
  defaultMode?: ColorMode;
  persistence?: ThemePersistence;
  preloadInactive?: boolean;
  onResolutionError?: (error: unknown, context: ThemeResolutionErrorContext) => void;
  storageKey?: string;
}
interface ThemeControllerCatalogOptions extends ThemeControllerBaseOptions {
  catalog: ThemeCatalog;
  resolver?: ThemeResolver;
}
interface ThemeControllerResolverOptions extends ThemeControllerBaseOptions {
  resolver: ThemeResolver;
}
type ThemeControllerOptions = ThemeControllerCatalogOptions | ThemeControllerResolverOptions;
interface ThemeSelection {
  darkThemeName: string;
  lightThemeName: string;
  mode: ColorMode;
}
interface ThemePersistence {
  load(): ThemeSelection | null;
  save(selection: ThemeSelection): void;
}
declare function createThemeController(options: ThemeControllerOptions): ThemeController;
//#endregion
export { PendingThemeResolution, ThemeController, ThemeControllerBaseOptions, ThemeControllerCatalogOptions, ThemeControllerOptions, ThemeControllerResolverOptions, ThemeControllerState, ThemePersistence, ThemeResolutionError, ThemeResolutionErrorContext, ThemeSelection, createThemeController };
//# sourceMappingURL=createThemeController.d.ts.map