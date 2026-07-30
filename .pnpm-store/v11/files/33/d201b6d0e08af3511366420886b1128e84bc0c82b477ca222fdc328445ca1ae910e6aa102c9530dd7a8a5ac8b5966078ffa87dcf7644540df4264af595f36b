import { Element, ElementContent, Properties, Root, Text } from "../node_modules/.pnpm/@types_hast@3.0.4/node_modules/@types/hast/index.js";
import { LineTypes } from "../types.js";
import { SVGSpriteNames } from "../sprite.js";

//#region src/utils/hast_utils.d.ts
declare function createTextNodeElement(value: string): Text;
interface CreateHastElementProps {
  tagName: 'span' | 'div' | 'button' | 'code' | 'pre' | 'slot' | 'svg' | 'use' | 'style' | 'template' | 'bdi';
  children?: ElementContent[];
  properties?: Properties;
}
declare function createHastElement({
  tagName,
  children,
  properties
}: CreateHastElementProps): Element;
interface CreateIconProps {
  name: SVGSpriteNames;
  width?: number;
  height?: number;
  properties?: Properties;
}
declare function createIconElement({
  name,
  width,
  height,
  properties
}: CreateIconProps): Element;
declare function findCodeElement(nodes: Root | Element): Element | undefined;
declare function createGutterWrapper(children?: ElementContent[]): Element;
declare function createGutterItem(lineType: LineTypes | 'buffer' | 'separator' | 'annotation', lineNumber: number, lineIndex: string, properties?: Properties): Element;
declare function createGutterGap(type: LineTypes | undefined, bufferType: 'annotation' | 'buffer' | 'metadata', size: number): Element;
//#endregion
export { createGutterGap, createGutterItem, createGutterWrapper, createHastElement, createIconElement, createTextNodeElement, findCodeElement };
//# sourceMappingURL=hast_utils.d.ts.map