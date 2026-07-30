"use strict";

var _interopRequireDefault = require("@babel/runtime/helpers/interopRequireDefault").default;
Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.QRCodeSVG = void 0;
var _extends2 = _interopRequireDefault(require("@babel/runtime/helpers/extends"));
var _react = _interopRequireDefault(require("react"));
var _utils = require("./utils");
var _useQRCode = require("./hooks/useQRCode");
const QRCodeSVG = exports.QRCodeSVG = /*#__PURE__*/_react.default.forwardRef((props, ref) => {
  const {
    value,
    size = _utils.DEFAULT_SIZE,
    level = _utils.DEFAULT_LEVEL,
    bgColor = _utils.DEFAULT_BACKGROUND_COLOR,
    fgColor = _utils.DEFAULT_FRONT_COLOR,
    includeMargin = _utils.DEFAULT_NEED_MARGIN,
    minVersion = _utils.DEFAULT_MINVERSION,
    title,
    marginSize,
    imageSettings,
    boostLevel,
    ...otherProps
  } = props;
  const {
    margin,
    cells,
    numCells,
    calculatedImageSettings
  } = (0, _useQRCode.useQRCode)({
    value,
    level,
    minVersion,
    includeMargin,
    marginSize,
    imageSettings,
    size,
    boostLevel
  });
  let cellsToDraw = cells;
  let image = null;
  if (imageSettings != null && calculatedImageSettings != null) {
    if (calculatedImageSettings.excavation != null) {
      cellsToDraw = (0, _utils.excavateModules)(cells, calculatedImageSettings.excavation);
    }
    image = /*#__PURE__*/_react.default.createElement("image", {
      href: imageSettings.src,
      height: calculatedImageSettings.h,
      width: calculatedImageSettings.w,
      x: calculatedImageSettings.x + margin,
      y: calculatedImageSettings.y + margin,
      preserveAspectRatio: "none",
      opacity: calculatedImageSettings.opacity
      // when crossOrigin is not set, the image will be tainted
      // and the canvas cannot be exported to an image
      ,
      crossOrigin: calculatedImageSettings.crossOrigin
    });
  }
  const fgPath = (0, _utils.generatePath)(cellsToDraw, margin);
  return /*#__PURE__*/_react.default.createElement("svg", (0, _extends2.default)({
    height: size,
    width: size,
    viewBox: `0 0 ${numCells} ${numCells}`,
    ref: ref,
    role: "img"
  }, otherProps), !!title && /*#__PURE__*/_react.default.createElement("title", null, title), /*#__PURE__*/_react.default.createElement("path", {
    fill: bgColor,
    d: `M0,0 h${numCells}v${numCells}H0z`,
    shapeRendering: "crispEdges"
  }), /*#__PURE__*/_react.default.createElement("path", {
    fill: fgColor,
    d: fgPath,
    shapeRendering: "crispEdges"
  }), image);
});
if (process.env.NODE_ENV !== 'production') {
  QRCodeSVG.displayName = 'QRCodeSVG';
}