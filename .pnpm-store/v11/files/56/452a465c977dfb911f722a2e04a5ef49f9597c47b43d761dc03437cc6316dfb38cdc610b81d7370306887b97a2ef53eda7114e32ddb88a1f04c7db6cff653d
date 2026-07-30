"use strict";

var _interopRequireDefault = require("@babel/runtime/helpers/interopRequireDefault").default;
Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
var _react = _interopRequireDefault(require("react"));
const DEFAULT_BORDER_INFO = {
  borderWidth: [0, 0, 0, 0],
  borderRadius: '0px'
};
const parseBorderWidth = value => {
  const size = Number.parseFloat(value);
  return Number.isFinite(size) ? size : 0;
};
const useBorderSize = domNode => {
  const [borderInfo, setBorderInfo] = _react.default.useState(DEFAULT_BORDER_INFO);
  _react.default.useEffect(() => {
    if (!domNode) {
      setBorderInfo(DEFAULT_BORDER_INFO);
      return;
    }
    const {
      borderTopWidth,
      borderRightWidth,
      borderBottomWidth,
      borderLeftWidth,
      borderRadius
    } = getComputedStyle(domNode);
    setBorderInfo({
      borderWidth: [parseBorderWidth(borderTopWidth), parseBorderWidth(borderRightWidth), parseBorderWidth(borderBottomWidth), parseBorderWidth(borderLeftWidth)],
      borderRadius
    });
  }, [domNode]);
  return borderInfo;
};
var _default = exports.default = useBorderSize;