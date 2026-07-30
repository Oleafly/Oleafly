"use strict";

var _interopRequireDefault = require("@babel/runtime/helpers/interopRequireDefault").default;
Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
var _react = _interopRequireDefault(require("react"));
var _is = require("../../_util/is");
const useSpinProps = loading => {
  const spinProps = _react.default.useMemo(() => {
    if (typeof loading === 'boolean') {
      return {
        spinning: loading
      };
    }
    if ((0, _is.isPlainObject)(loading)) {
      return {
        spinning: true,
        ...loading
      };
    }
    return {};
  }, [loading]);
  return spinProps;
};
var _default = exports.default = useSpinProps;