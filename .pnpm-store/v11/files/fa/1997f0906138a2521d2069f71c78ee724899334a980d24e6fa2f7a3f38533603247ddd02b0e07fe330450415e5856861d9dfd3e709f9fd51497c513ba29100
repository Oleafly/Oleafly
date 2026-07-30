"use strict";

var _interopRequireDefault = require("@babel/runtime/helpers/interopRequireDefault").default;
Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.getFontSize = exports.getContentLines = exports.getCanvasFont = void 0;
exports.getPixelRatio = getPixelRatio;
exports.getStyleStr = getStyleStr;
exports.reRendering = void 0;
exports.toLowercaseSeparator = toLowercaseSeparator;
var _util = require("@rc-component/util");
var _is = require("../_util/is");
var _toList = _interopRequireDefault(require("../_util/toList"));
/** converting camel-cased strings to be lowercase and link it with Separator */
function toLowercaseSeparator(key) {
  return key.replace(/([A-Z])/g, '-$1').toLowerCase();
}
function getStyleStr(style) {
  return Object.keys(style).map(key => `${toLowercaseSeparator(key)}: ${style[key]};`).join(' ');
}
/** Returns the ratio of the device's physical pixel resolution to the css pixel resolution */
function getPixelRatio() {
  return window.devicePixelRatio || 1;
}
const isWatermarkText = content => (0, _is.isPlainObject)(content);
const getFontSize = (font, ratio = 1) => {
  return Number(font.fontSize) * ratio;
};
exports.getFontSize = getFontSize;
const getCanvasFont = (font, ratio = 1, lineHeight) => {
  const mergedLineHeight = lineHeight === undefined ? '' : `/${lineHeight}px`;
  return `${font.fontStyle} normal ${font.fontWeight} ${getFontSize(font, ratio)}px${mergedLineHeight} ${font.fontFamily}`;
};
exports.getCanvasFont = getCanvasFont;
const getContentLines = (content, font) => (0, _toList.default)(content, {
  skipEmpty: true
}).map(item => {
  if (isWatermarkText(item)) {
    return {
      text: item.text ?? '',
      font: (0, _util.mergeProps)(font, item.font ?? {})
    };
  }
  return {
    text: item ?? '',
    font
  };
});
/** Whether to re-render the watermark */
exports.getContentLines = getContentLines;
const reRendering = (mutation, isWatermarkEle) => {
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
exports.reRendering = reRendering;