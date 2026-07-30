"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = useShowSizeChanger;
var _react = require("react");
var _is = require("../_util/is");
function useShowSizeChanger(showSizeChanger) {
  return (0, _react.useMemo)(() => {
    if (typeof showSizeChanger === 'boolean') {
      return [showSizeChanger, {}];
    }
    if ((0, _is.isPlainObject)(showSizeChanger)) {
      return [true, showSizeChanger];
    }
    return [undefined, undefined];
  }, [showSizeChanger]);
}