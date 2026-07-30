"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
var _react = require("react");
var _is = require("./is");
const convertToTooltipProps = (tooltip, context) => {
  if (!(0, _is.isReactRenderable)(tooltip)) {
    return null;
  }
  if ((0, _is.isPlainObject)(tooltip) && ! /*#__PURE__*/(0, _react.isValidElement)(tooltip)) {
    return {
      ...context,
      ...tooltip
    };
  }
  return {
    ...context,
    title: tooltip
  };
};
var _default = exports.default = convertToTooltipProps;