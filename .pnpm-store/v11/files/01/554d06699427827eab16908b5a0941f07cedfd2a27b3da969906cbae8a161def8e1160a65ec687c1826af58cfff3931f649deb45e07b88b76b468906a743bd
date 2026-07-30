import { DiffsHighlighter, DiffsThemeNames, HighlighterTypes, SupportedLanguages } from "../types.js";

//#region src/highlighter/shared_highlighter.d.ts
type CachedOrLoadingHighlighterType = Promise<DiffsHighlighter> | DiffsHighlighter | undefined;
interface HighlighterOptions {
  themes: DiffsThemeNames[];
  langs: SupportedLanguages[];
  preferredHighlighter?: HighlighterTypes;
}
declare function getSharedHighlighter({
  themes,
  langs,
  preferredHighlighter
}: HighlighterOptions): Promise<DiffsHighlighter>;
declare function isHighlighterLoaded(h?: CachedOrLoadingHighlighterType): h is DiffsHighlighter;
declare function getHighlighterIfLoaded(): DiffsHighlighter | undefined;
declare function isHighlighterLoading(h?: CachedOrLoadingHighlighterType): h is Promise<DiffsHighlighter>;
declare function isHighlighterNull(h?: CachedOrLoadingHighlighterType): h is undefined;
declare function preloadHighlighter(options: HighlighterOptions): Promise<void>;
declare function disposeHighlighter(): Promise<void>;
//#endregion
export { disposeHighlighter, getHighlighterIfLoaded, getSharedHighlighter, isHighlighterLoaded, isHighlighterLoading, isHighlighterNull, preloadHighlighter };
//# sourceMappingURL=shared_highlighter.d.ts.map