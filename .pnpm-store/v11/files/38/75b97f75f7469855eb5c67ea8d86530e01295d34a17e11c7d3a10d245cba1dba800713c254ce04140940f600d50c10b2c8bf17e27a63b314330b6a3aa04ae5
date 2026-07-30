import { ThemeLike } from "./types.js";
import { ThemeCollection, ThemeCollectionInput } from "./createThemeCollection.js";

//#region src/modules/createThemeCatalog.d.ts
interface ThemeCatalog<TTheme extends ThemeLike = ThemeLike> extends ThemeCollection<TTheme> {
  defaultLightThemeName: string;
  defaultDarkThemeName: string;
}
declare function createThemeCatalog<TTheme extends ThemeLike>(options: {
  themes: ThemeCollectionInput<TTheme>;
  defaultLightThemeName: string;
  defaultDarkThemeName: string;
}): ThemeCatalog<TTheme>;
//#endregion
export { ThemeCatalog, createThemeCatalog };
//# sourceMappingURL=createThemeCatalog.d.ts.map