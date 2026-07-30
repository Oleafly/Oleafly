"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = useSemantic;
var _react = require("react");
/**
 * Convert `classNames` & `styles` to a fully filled object
 */
function useSemantic(classNames, styles) {
  return (0, _react.useMemo)(() => {
    const mergedClassNames = {
      ...classNames,
      popup: classNames?.popup || {}
    };
    const mergedStyles = {
      ...styles,
      popup: styles?.popup || {}
    };
    return [mergedClassNames, mergedStyles];
  }, [classNames, styles]);
}