import { ThemeLike } from "./types.js";
import { ThemeLoader, ThemeResolver } from "./createThemeResolver.js";

//#region src/modules/createThemeCollection.d.ts
interface ThemeDescriptor<TTheme extends ThemeLike = ThemeLike> {
  name: string;
  load: ThemeLoader<TTheme>;
  colorScheme?: 'light' | 'dark';
  collection?: string;
  displayName?: string;
}
interface ThemeCollectionFilter {
  collection?: string;
  colorScheme?: 'light' | 'dark';
}
type ThemeCollectionComparator<TTheme extends ThemeLike = ThemeLike> = (a: ThemeDescriptor<TTheme>, b: ThemeDescriptor<TTheme>) => number;
interface ThemeCollectionSource<TTheme extends ThemeLike = ThemeLike> {
  getThemes(options?: ThemeCollectionFilter): readonly ThemeDescriptor<TTheme>[];
}
interface ThemeCollection<TTheme extends ThemeLike = ThemeLike> extends ThemeCollectionSource<TTheme> {
  getTheme(name: string): ThemeDescriptor<TTheme> | undefined;
  getThemeNames(options?: ThemeCollectionFilter): readonly string[];
  hasTheme(name: string): boolean;
  orderBy(compare: ThemeCollectionComparator<TTheme>): ThemeCollection<TTheme>;
  pick(names: readonly string[]): ThemeCollection<TTheme>;
  registerInto(resolver: ThemeResolver<TTheme>): void;
}
type ThemeCollectionEntry<TTheme extends ThemeLike = ThemeLike> = ThemeDescriptor<TTheme> | ThemeCollectionSource<TTheme>;
type ThemeCollectionInput<TTheme extends ThemeLike = ThemeLike> = ThemeCollectionEntry<TTheme> | Iterable<ThemeCollectionEntry<TTheme>>;
declare function createThemeCollection<TTheme extends ThemeLike>(options: {
  themes: ThemeCollectionInput<TTheme>;
}): ThemeCollection<TTheme>;
//#endregion
export { ThemeCollection, ThemeCollectionComparator, ThemeCollectionEntry, ThemeCollectionFilter, ThemeCollectionInput, ThemeCollectionSource, ThemeDescriptor, createThemeCollection };
//# sourceMappingURL=createThemeCollection.d.ts.map