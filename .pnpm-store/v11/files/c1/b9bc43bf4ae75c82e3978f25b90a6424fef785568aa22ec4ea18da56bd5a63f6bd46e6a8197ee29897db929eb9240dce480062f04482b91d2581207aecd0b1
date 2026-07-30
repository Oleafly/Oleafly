import { isString } from '../is';
export const isValidWaveColor = color => {
  if (!color) {
    return false;
  }
  return isString(color) && color !== '#fff' && color !== '#ffffff' && color !== 'rgb(255, 255, 255)' && color !== 'rgba(255, 255, 255, 1)' && !/rgba\((?:\d*, ){3}0\)/i.test(color) &&
  // any transparent rgba color
  !/^#(?:[0-9a-f]{3}0|[0-9a-f]{6}00)$/i.test(color) &&
  // any transparent hex color
  color !== 'transparent' && color !== 'canvastext';
};
export function getTargetWaveColor(node, colorSource = null) {
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