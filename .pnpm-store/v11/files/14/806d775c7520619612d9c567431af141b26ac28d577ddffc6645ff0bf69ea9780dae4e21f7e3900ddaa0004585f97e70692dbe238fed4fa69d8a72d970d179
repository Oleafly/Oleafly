import { default as Color } from 'color';
import { XColor } from './types';
export declare const XColorCoreModelToColor: {
    rgb: ([r, g, b]: number[]) => Color<number[]>;
    cmy: ([c, m, y]: number[]) => Color<number[]>;
    cmyk: ([c, m, y, k]: number[]) => Color<number[]>;
    hsb: ([h, s, b]: number[]) => Color<number[]>;
    gray: ([v]: number[]) => Color<number[]>;
};
export declare const PREDEFINED_XCOLOR_COLORS: Record<string, Color<any>>;
/**
 * Given a parsed `XColor`, compute the color and return a `Color` object
 * (that can be used in CSS, for example).
 */
export declare function computeColor(expr: XColor, predefinedColors?: Record<string, Color<any>>): Color<any>;
/**
 * Convert the xcolor defined color to RGB Hex representation.
 * If the color is unknown or cannot be computed, `null` is returned.
 *
 * If `model` is supplied,
 *
 * The most likely reason a color will be `null` is if the color is defined
 * using a pre-defined color that wasn't supplied as an argument.
 */
export declare function xcolorColorToHex(color: string, model?: string | null, options?: {
    predefinedColors?: Record<string, Color<any>>;
}): string | null;
//# sourceMappingURL=xcolor.d.ts.map