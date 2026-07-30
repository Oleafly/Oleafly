"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.subscribeToVisualViewportResize = subscribeToVisualViewportResize;
var _addEventListener = require("@base-ui/utils/addEventListener");
var _owner = require("@base-ui/utils/owner");
// This lets us invert the scale of the cursor to match the OS scale, in which the cursor doesn't
// scale with the content on pinch-zoom.
function subscribeToVisualViewportResize(element, visualScaleRef) {
  const vV = (0, _owner.ownerWindow)(element).visualViewport;
  if (!vV) {
    return () => {};
  }
  function handleVisualResize() {
    if (vV) {
      visualScaleRef.current = vV.scale;
    }
  }
  handleVisualResize();
  return (0, _addEventListener.addEventListener)(vV, 'resize', handleVisualResize);
}