"use strict";

var _interopRequireDefault = require("@babel/runtime/helpers/interopRequireDefault").default;
Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.QRCodeCanvas = void 0;
var _extends2 = _interopRequireDefault(require("@babel/runtime/helpers/extends"));
var _react = _interopRequireDefault(require("react"));
var _useQRCode = require("./hooks/useQRCode");
var _utils = require("./utils");
const QRCodeCanvas = exports.QRCodeCanvas = /*#__PURE__*/_react.default.forwardRef((props, ref) => {
  const {
    value,
    size = _utils.DEFAULT_SIZE,
    level = _utils.DEFAULT_LEVEL,
    bgColor = _utils.DEFAULT_BACKGROUND_COLOR,
    fgColor = _utils.DEFAULT_FRONT_COLOR,
    includeMargin = _utils.DEFAULT_NEED_MARGIN,
    minVersion = _utils.DEFAULT_MINVERSION,
    marginSize,
    style,
    imageSettings,
    boostLevel,
    ...otherProps
  } = props;
  const imgSrc = imageSettings?.src;
  const _canvas = _react.default.useRef(null);
  const _image = _react.default.useRef(null);
  const setCanvasRef = _react.default.useCallback(node => {
    _canvas.current = node;
    if (typeof ref === 'function') {
      ref(node);
    } else if (ref) {
      ref.current = node;
    }
  }, [ref]);
  const [, setIsImageLoaded] = _react.default.useState(false);
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
  _react.default.useEffect(() => {
    if (_canvas.current) {
      const canvas = _canvas.current;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        return;
      }
      let cellsToDraw = cells;
      const image = _image.current;
      const haveImageToRender = calculatedImageSettings != null && image !== null && image.complete && image.naturalHeight !== 0 && image.naturalWidth !== 0;
      if (haveImageToRender) {
        if (calculatedImageSettings.excavation != null) {
          cellsToDraw = (0, _utils.excavateModules)(cells, calculatedImageSettings.excavation);
        }
      }
      const pixelRatio = window.devicePixelRatio || 1;
      canvas.height = canvas.width = size * pixelRatio;
      const scale = size / numCells * pixelRatio;
      ctx.scale(scale, scale);
      ctx.fillStyle = bgColor;
      ctx.fillRect(0, 0, numCells, numCells);
      ctx.fillStyle = fgColor;
      if (_utils.isSupportPath2d) {
        ctx.fill(new Path2D((0, _utils.generatePath)(cellsToDraw, margin)));
      } else {
        cells.forEach((row, rdx) => {
          row.forEach((cell, cdx) => {
            if (cell) {
              ctx.fillRect(cdx + margin, rdx + margin, 1, 1);
            }
          });
        });
      }
      if (calculatedImageSettings) {
        ctx.globalAlpha = calculatedImageSettings.opacity;
      }
      if (haveImageToRender) {
        ctx.drawImage(image, calculatedImageSettings.x + margin, calculatedImageSettings.y + margin, calculatedImageSettings.w, calculatedImageSettings.h);
      }
    }
  });
  _react.default.useEffect(() => {
    setIsImageLoaded(false);
  }, [imgSrc]);
  const canvasStyle = {
    height: size,
    width: size,
    ...style
  };
  let img = null;
  if (imgSrc != null) {
    img = /*#__PURE__*/_react.default.createElement("img", {
      alt: "QR-Code",
      src: imgSrc,
      key: imgSrc,
      style: {
        display: 'none'
      },
      onLoad: () => {
        setIsImageLoaded(true);
      },
      ref: _image
      // when crossOrigin is not set, the image will be tainted
      // and the canvas cannot be exported to an image
      ,
      crossOrigin: calculatedImageSettings?.crossOrigin
    });
  }
  return /*#__PURE__*/_react.default.createElement(_react.default.Fragment, null, /*#__PURE__*/_react.default.createElement("canvas", (0, _extends2.default)({
    style: canvasStyle,
    height: size,
    width: size,
    ref: setCanvasRef,
    role: "img"
  }, otherProps)), img);
});
if (process.env.NODE_ENV !== 'production') {
  QRCodeCanvas.displayName = 'QRCodeCanvas';
}