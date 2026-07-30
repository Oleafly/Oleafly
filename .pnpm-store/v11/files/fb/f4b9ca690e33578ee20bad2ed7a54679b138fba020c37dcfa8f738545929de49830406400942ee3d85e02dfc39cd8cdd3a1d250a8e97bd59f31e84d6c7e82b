"use strict";

var _interopRequireDefault = require("@babel/runtime/helpers/interopRequireDefault").default;
Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.useQRCode = void 0;
var _qrcodegen = require("../libs/qrcodegen");
var _utils = require("../utils");
var _react = _interopRequireDefault(require("react"));
const useQRCode = opt => {
  const {
    value,
    level,
    minVersion,
    includeMargin,
    marginSize,
    imageSettings,
    size,
    boostLevel
  } = opt;
  const memoizedQrcode = _react.default.useMemo(() => {
    const values = Array.isArray(value) ? value : [value];
    const segments = values.reduce((acc, val) => {
      acc.push(..._qrcodegen.QrSegment.makeSegments(val));
      return acc;
    }, []);
    return _qrcodegen.QrCode.encodeSegments(segments, _utils.ERROR_LEVEL_MAP[level], minVersion, undefined, undefined, boostLevel);
  }, [value, level, minVersion, boostLevel]);
  return _react.default.useMemo(() => {
    const cs = memoizedQrcode.getModules();
    const mg = (0, _utils.getMarginSize)(includeMargin, marginSize);
    const ncs = cs.length + mg * 2;
    const cis = (0, _utils.getImageSettings)(cs, size, mg, imageSettings);
    return {
      cells: cs,
      margin: mg,
      numCells: ncs,
      calculatedImageSettings: cis,
      qrcode: memoizedQrcode
    };
  }, [memoizedQrcode, size, imageSettings, includeMargin, marginSize]);
};
exports.useQRCode = useQRCode;