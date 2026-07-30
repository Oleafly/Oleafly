//#region src/types/customToken.d.ts
declare const PresetColors: readonly ["red", "volcano", "orange", "gold", "yellow", "lime", "green", "cyan", "blue", "geekblue", "purple", "magenta", "gray"];
declare const PresetSystemColors: readonly ["Error", "Warning", "Success", "Info"];
type PresetColorKey = (typeof PresetColors)[number];
type PresetSystemColorKey = (typeof PresetSystemColors)[number];
type PresetColorType = Record<PresetColorKey, string>;
type PresetSystemColorType = Record<PresetSystemColorKey, string>;
type ColorPaletteKeyIndex = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11;
type ColorTokenKey = 'Fill' | 'FillSecondary' | 'FillTertiary' | 'FillQuaternary' | 'Bg' | 'BgHover' | 'Border' | 'BorderSecondary' | 'BorderHover' | 'Hover' | '' | 'Active' | 'TextHover' | 'Text' | 'TextActive';
type SystemColorTokenKey = 'Fill' | 'FillSecondary' | 'FillTertiary' | 'FillQuaternary';
type ColorToken = { [key in `${keyof PresetColorType}${ColorTokenKey}`]: string; };
type SystemColorToken = { [key in `color${keyof PresetSystemColorType}${SystemColorTokenKey}`]: string; };
type ColorPalettes = { [key in `${keyof PresetColorType}${ColorPaletteKeyIndex}`]: string; };
type ColorPalettesAlpha = { [key in `${keyof PresetColorType}${ColorPaletteKeyIndex}A`]: string; };
interface LobeCustomToken extends ColorPalettes, ColorPalettesAlpha, ColorToken, SystemColorToken {
  colorBgContainerSecondary: string;
}
//#endregion
export { ColorPalettes, ColorPalettesAlpha, ColorToken, LobeCustomToken, PresetColorKey, PresetColorType, PresetSystemColorKey, PresetSystemColorType, SystemColorToken };
//# sourceMappingURL=customToken.d.mts.map