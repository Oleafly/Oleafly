"use strict";

var _interopRequireDefault = require("@babel/runtime/helpers/interopRequireDefault").default;
Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
var _react = _interopRequireDefault(require("react"));
var _is = require("../../_util/is");
var _SizeContext = _interopRequireDefault(require("../SizeContext"));
const useSize = customSize => {
  const size = _react.default.useContext(_SizeContext.default);
  const mergedSize = _react.default.useMemo(() => {
    if (!customSize) {
      return size;
    }
    if ((0, _is.isString)(customSize)) {
      return customSize ?? size;
    }
    if ((0, _is.isFunction)(customSize)) {
      return customSize(size);
    }
    return size;
  }, [customSize, size]);
  return mergedSize;
};
var _default = exports.default = useSize;