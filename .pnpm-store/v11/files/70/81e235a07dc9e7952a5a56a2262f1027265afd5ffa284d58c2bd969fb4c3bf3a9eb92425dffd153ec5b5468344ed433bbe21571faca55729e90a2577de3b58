"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.findScrollableTouchTarget = findScrollableTouchTarget;
exports.hasScrollableAncestor = hasScrollableAncestor;
exports.isScrollable = isScrollable;
var _dom = require("@floating-ui/utils/dom");
function isScrollable(element, axis,
// When true, a container that overflows only once extra space is added (e.g. drawer
// keyboard scroll slack) still counts, as long as it has layout size on the axis.
allowOverflowIntent = false) {
  const style = (0, _dom.getComputedStyle)(element);
  if (axis === 'vertical') {
    const overflowY = style.overflowY;
    if (overflowY !== 'auto' && overflowY !== 'scroll') {
      return false;
    }
    return allowOverflowIntent ? element.clientHeight > 0 : element.scrollHeight > element.clientHeight;
  }
  const overflowX = style.overflowX;
  if (overflowX !== 'auto' && overflowX !== 'scroll') {
    return false;
  }
  return allowOverflowIntent ? element.clientWidth > 0 : element.scrollWidth > element.clientWidth;
}
function hasScrollableAncestor(target, root, axes) {
  // `getParentNode` crosses shadow boundaries (and slots), so a target inside a shadow root
  // still walks up to scrollable ancestors in the light DOM.
  let node = target;
  while ((0, _dom.isHTMLElement)(node) && node !== root && !(0, _dom.isLastTraversableNode)(node)) {
    for (const axis of axes) {
      if (isScrollable(node, axis)) {
        return true;
      }
    }
    node = (0, _dom.getParentNode)(node);
  }
  return false;
}
function findScrollableTouchTarget(target, root, axis = 'vertical', allowOverflowIntent = false) {
  // `getParentNode` crosses shadow boundaries (and slots), so a target inside a shadow root
  // still reaches a scrollable ancestor in the light DOM.
  let node = (0, _dom.isHTMLElement)(target) ? target : null;
  while ((0, _dom.isHTMLElement)(node) && node !== root && !(0, _dom.isLastTraversableNode)(node)) {
    if (isScrollable(node, axis, allowOverflowIntent)) {
      return node;
    }
    node = (0, _dom.getParentNode)(node);
  }
  return isScrollable(root, axis, allowOverflowIntent) ? root : null;
}