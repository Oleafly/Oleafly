"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.getTargetWaveColor = getTargetWaveColor;
exports.isValidWaveColor = void 0;
var _is = require("../is");
const isValidWaveColor = color => {
  if (!color) {
    return false;
  }
  return (0, _is.isString)(color) && color !== '#fff' && color !== '#ffffff' && color !== 'rgb(255, 255, 255)' && color !== 'rgba(255, 255, 255, 1)' && !/rgba\((?:\d*, ){3}0\)/i.test(color) &&
  // any transparent rgba color
  !/^#(?:[0-9a-f]{3}0|[0-9a-f]{6}00)$/i.test(color) &&
  // any transparent hex color
  color !== 'transparent' && color !== 'canvastext';
};
exports.isValidWaveColor = isValidWaveColor;
function getTargetWaveColor(node, colorSource = null) {
  const style = getComputedStyle(node);
  const {
    borderTopColor,
    borderColor,
    backgroundColor
  } = style;
  if (colorSource && isValidWaveColor(style[colorSource])) {
    return style[colorSource];
  }
  return [borderTopColor, borderColor, backgroundColor].find(isValidWaveColor) ?? null;
}