import { mergeProps } from '@rc-component/util';
import { isPlainObject } from '../_util/is';
import toList from '../_util/toList';
/** converting camel-cased strings to be lowercase and link it with Separator */
export function toLowercaseSeparator(key) {
  return key.replace(/([A-Z])/g, '-$1').toLowerCase();
}
export function getStyleStr(style) {
  return Object.keys(style).map(key => `${toLowercaseSeparator(key)}: ${style[key]};`).join(' ');
}
/** Returns the ratio of the device's physical pixel resolution to the css pixel resolution */
export function getPixelRatio() {
  return window.devicePixelRatio || 1;
}
const isWatermarkText = content => isPlainObject(content);
export const getFontSize = (font, ratio = 1) => {
  return Number(font.fontSize) * ratio;
};
export const getCanvasFont = (font, ratio = 1, lineHeight) => {
  const mergedLineHeight = lineHeight === undefined ? '' : `/${lineHeight}px`;
  return `${font.fontStyle} normal ${font.fontWeight} ${getFontSize(font, ratio)}px${mergedLineHeight} ${font.fontFamily}`;
};
export const getContentLines = (content, font) => toList(content, {
  skipEmpty: true
}).map(item => {
  if (isWatermarkText(item)) {
    return {
      text: item.text ?? '',
      font: mergeProps(font, item.font ?? {})
    };
  }
  return {
    text: item ?? '',
    font
  };
});
/** Whether to re-render the watermark */
export const reRendering = (mutation, isWatermarkEle) => {
  let flag = false;
  // Whether to delete the watermark node
  if (mutation.removedNodes.length) {
    flag = Array.from(mutation.removedNodes).some(isWatermarkEle);
  }
  // Whether the watermark dom property value has been modified
  if (mutation.type === 'attributes' && isWatermarkEle(mutation.target)) {
    flag = true;
  }
  return flag;
};