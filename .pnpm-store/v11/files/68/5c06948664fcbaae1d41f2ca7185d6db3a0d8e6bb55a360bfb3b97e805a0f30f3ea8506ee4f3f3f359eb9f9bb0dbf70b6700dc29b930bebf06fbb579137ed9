import _extends from "@babel/runtime/helpers/esm/extends";
import React from 'react';
import { DEFAULT_BACKGROUND_COLOR, DEFAULT_FRONT_COLOR, DEFAULT_NEED_MARGIN, DEFAULT_LEVEL, DEFAULT_MINVERSION, DEFAULT_SIZE, excavateModules, generatePath } from "./utils";
import { useQRCode } from "./hooks/useQRCode";
const QRCodeSVG = /*#__PURE__*/React.forwardRef((props, ref) => {
  const {
    value,
    size = DEFAULT_SIZE,
    level = DEFAULT_LEVEL,
    bgColor = DEFAULT_BACKGROUND_COLOR,
    fgColor = DEFAULT_FRONT_COLOR,
    includeMargin = DEFAULT_NEED_MARGIN,
    minVersion = DEFAULT_MINVERSION,
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
  } = useQRCode({
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
      cellsToDraw = excavateModules(cells, calculatedImageSettings.excavation);
    }
    image = /*#__PURE__*/React.createElement("image", {
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
  const fgPath = generatePath(cellsToDraw, margin);
  return /*#__PURE__*/React.createElement("svg", _extends({
    height: size,
    width: size,
    viewBox: `0 0 ${numCells} ${numCells}`,
    ref: ref,
    role: "img"
  }, otherProps), !!title && /*#__PURE__*/React.createElement("title", null, title), /*#__PURE__*/React.createElement("path", {
    fill: bgColor,
    d: `M0,0 h${numCells}v${numCells}H0z`,
    shapeRendering: "crispEdges"
  }), /*#__PURE__*/React.createElement("path", {
    fill: fgColor,
    d: fgPath,
    shapeRendering: "crispEdges"
  }), image);
});
if (process.env.NODE_ENV !== 'production') {
  QRCodeSVG.displayName = 'QRCodeSVG';
}
export { QRCodeSVG };