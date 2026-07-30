import type { WatermarkContent, WatermarkFont } from '.';
/** converting camel-cased strings to be lowercase and link it with Separator */
export declare function toLowercaseSeparator(key: string): string;
export declare function getStyleStr(style: React.CSSProperties): string;
/** Returns the ratio of the device's physical pixel resolution to the css pixel resolution */
export declare function getPixelRatio(): number;
export interface WatermarkContentLine {
    text: string;
    font: Required<WatermarkFont>;
}
export declare const getFontSize: (font: Required<WatermarkFont>, ratio?: number) => number;
export declare const getCanvasFont: (font: Required<WatermarkFont>, ratio?: number, lineHeight?: number) => string;
export declare const getContentLines: (content: WatermarkContent | WatermarkContent[] | undefined, font: Required<WatermarkFont>) => WatermarkContentLine[];
/** Whether to re-render the watermark */
export declare const reRendering: (mutation: MutationRecord, isWatermarkEle: (ele: Node, index?: number) => boolean) => boolean;
