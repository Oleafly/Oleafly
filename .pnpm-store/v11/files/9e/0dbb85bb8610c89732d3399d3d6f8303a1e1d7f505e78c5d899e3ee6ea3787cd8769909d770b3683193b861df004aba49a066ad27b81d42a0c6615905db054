import { ThemeLike } from "./types.js";
import { ThemeLoader } from "./createThemeResolver.js";
import { ThemeDescriptor } from "./createThemeCollection.js";

//#region src/modules/createTheme.d.ts
interface CreateThemeOptions {
  name: string;
  load: ThemeLoader;
  colorScheme?: 'light' | 'dark';
  collection?: string;
  displayName?: string;
}
declare function createTheme<TTheme extends ThemeLike = ThemeLike>({
  name,
  load,
  colorScheme,
  collection,
  displayName
}: CreateThemeOptions): ThemeDescriptor<TTheme>;
//#endregion
export { CreateThemeOptions, createTheme };
//# sourceMappingURL=createTheme.d.ts.map