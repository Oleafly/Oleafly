"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.hide = void 0;
var _reactDom = require("@floating-ui/react-dom");
const nativeHideFn = (0, _reactDom.hide)().fn;
const hide = exports.hide = {
  name: 'hide',
  async fn(state) {
    const {
      width,
      height,
      x,
      y
    } = state.rects.reference;
    const anchorHidden = width === 0 && height === 0 && x === 0 && y === 0;
    const nativeHideResult = await nativeHideFn(state);
    return {
      data: {
        referenceHidden: nativeHideResult.data?.referenceHidden || anchorHidden
      }
    };
  }
};