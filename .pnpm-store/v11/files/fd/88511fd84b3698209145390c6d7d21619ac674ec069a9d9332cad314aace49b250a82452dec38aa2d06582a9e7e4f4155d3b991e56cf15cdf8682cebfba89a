"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.getOffset = getOffset;
function getOffset(element, prop, axis) {
  if (!element) {
    return 0;
  }
  const styles = getComputedStyle(element);
  const propAxis = axis === 'x' ? 'Inline' : 'Block';

  // Safari misreports `marginInlineEnd` in RTL.
  // We have to assume the start/end values are symmetrical, which is likely.
  if (axis === 'x' && prop === 'margin') {
    return parseFloat(styles[`${prop}InlineStart`]) * 2;
  }
  return parseFloat(styles[`${prop}${propAxis}Start`]) + parseFloat(styles[`${prop}${propAxis}End`]);
}