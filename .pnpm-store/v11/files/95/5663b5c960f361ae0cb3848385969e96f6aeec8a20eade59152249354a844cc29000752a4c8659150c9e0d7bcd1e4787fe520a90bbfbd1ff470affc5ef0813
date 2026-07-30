import { ThemeLike } from "./types.js";
import { DefaultExport } from "./unwrapDefault.js";

//#region src/modules/createThemeResolver.d.ts
interface ThemeLoader<TTheme extends ThemeLike = ThemeLike> {
  (): Promise<TTheme | DefaultExport<TTheme>>;
}
interface ThemeResolver<TTheme extends ThemeLike = ThemeLike> {
  seedResolvedTheme(name: string, theme: TTheme): void;
  seedResolvedThemes(entries: Iterable<readonly [string, TTheme]>): void;
  clearResolvedThemes(): void;
  getResolvedOrResolveTheme(name: string): TTheme | Promise<TTheme>;
  getResolvedTheme(name: string): TTheme | undefined;
  getResolvedThemes(names: readonly string[]): TTheme[];
  hasRegisteredTheme(name: string): boolean;
  hasResolvedTheme(name: string): boolean;
  hasResolvedThemes(names: readonly string[]): boolean;
  registerTheme(name: string, loader: ThemeLoader<TTheme>): void;
  registerThemeIfAbsent(name: string, loader: ThemeLoader<TTheme>): boolean;
  resolveTheme(name: string): Promise<TTheme>;
  resolveThemes(names: readonly string[]): Promise<TTheme[]>;
}
declare class DuplicateThemeError extends Error {
  constructor(name: string);
}
declare class UnregisteredThemeError extends Error {
  constructor(name: string);
}
declare class UnresolvedThemeError extends Error {
  constructor(name: string);
}
declare function createThemeResolver<TTheme extends ThemeLike = ThemeLike>(): ThemeResolver<TTheme>;
//#endregion
export { DuplicateThemeError, ThemeLoader, ThemeResolver, UnregisteredThemeError, UnresolvedThemeError, createThemeResolver };
//# sourceMappingURL=createThemeResolver.d.ts.map