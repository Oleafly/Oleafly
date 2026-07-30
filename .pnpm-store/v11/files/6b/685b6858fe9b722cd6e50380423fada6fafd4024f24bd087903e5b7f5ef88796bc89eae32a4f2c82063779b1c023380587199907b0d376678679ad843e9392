"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.getRenderPropValue = void 0;
var _is = require("./is");
const getRenderPropValue = propValue => {
  if (!(0, _is.isReactRenderable)(propValue)) {
    return null;
  }
  return (0, _is.isFunction)(propValue) ? propValue() : propValue;
};
exports.getRenderPropValue = getRenderPropValue;