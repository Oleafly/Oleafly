"use strict";
"use client";

var _interopRequireWildcard = require("@babel/runtime/helpers/interopRequireWildcard").default;
Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
var React = _interopRequireWildcard(require("react"));
var _clsx = require("clsx");
var _is = require("../_util/is");
var _warning = require("../_util/warning");
const Element = props => {
  const {
    prefixCls,
    className,
    style,
    size,
    shape
  } = props;
  if (process.env.NODE_ENV !== 'production') {
    const warning = (0, _warning.devUseWarning)('Skeleton');
    warning.deprecated(size !== 'default', 'size="default"', 'size="medium"');
  }
  const sizeCls = (0, _clsx.clsx)({
    [`${prefixCls}-lg`]: size === 'large',
    [`${prefixCls}-sm`]: size === 'small'
  });
  const shapeCls = (0, _clsx.clsx)({
    [`${prefixCls}-circle`]: shape === 'circle',
    [`${prefixCls}-square`]: shape === 'square',
    [`${prefixCls}-round`]: shape === 'round'
  });
  const sizeStyle = React.useMemo(() => (0, _is.isNumber)(size) ? {
    width: size,
    height: size,
    lineHeight: `${size}px`
  } : {}, [size]);
  return /*#__PURE__*/React.createElement("span", {
    className: (0, _clsx.clsx)(prefixCls, sizeCls, shapeCls, className),
    style: {
      ...sizeStyle,
      ...style
    }
  });
};
var _default = exports.default = Element;