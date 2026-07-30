"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = usePlaceholderConfig;
exports.isPlaceholderConfig = isPlaceholderConfig;
var _react = require("react");
var _is = require("../../_util/is");
function isPlaceholderConfig(placeholder) {
  return (0, _is.isPlainObject)(placeholder) && ! /*#__PURE__*/(0, _react.isValidElement)(placeholder);
}
function usePlaceholderConfig(placeholder) {
  return (0, _react.useMemo)(() => {
    if (!placeholder || !isPlaceholderConfig(placeholder)) {
      return {};
    }
    if (typeof placeholder.progress === 'boolean') {
      return {
        progressConfig: placeholder.progress ? {} : undefined
      };
    }
    return {
      progressConfig: placeholder.progress
    };
  }, [placeholder]);
}