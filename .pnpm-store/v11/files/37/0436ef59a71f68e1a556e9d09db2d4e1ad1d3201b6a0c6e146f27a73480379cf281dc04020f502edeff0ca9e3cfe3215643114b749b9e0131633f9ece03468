"use strict";
"use client";

var _interopRequireDefault = require("@babel/runtime/helpers/interopRequireDefault").default;
var _interopRequireWildcard = require("@babel/runtime/helpers/interopRequireWildcard").default;
Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = exports.InternalTypography = void 0;
var React = _interopRequireWildcard(require("react"));
var _clsx = require("clsx");
var _useTypographySemantic = require("./hooks/useTypographySemantic");
var _style = _interopRequireDefault(require("./style"));
const InternalTypography = exports.InternalTypography = /*#__PURE__*/React.forwardRef((props, ref) => {
  const {
    component: Component = 'article',
    className,
    rootClassName,
    children,
    direction,
    style,
    classNames,
    styles,
    prefixCls,
    ...restProps
  } = props;
  const [hashId, cssVarCls] = (0, _style.default)(prefixCls);
  const componentClassName = (0, _clsx.clsx)(prefixCls, {
    [`${prefixCls}-rtl`]: direction === 'rtl'
  }, className, rootClassName, hashId, cssVarCls, classNames?.root);
  const mergedStyle = {
    ...styles?.root,
    ...style
  };
  return /*#__PURE__*/React.createElement(Component, {
    ...restProps,
    className: componentClassName,
    style: mergedStyle,
    ref: ref
  }, children);
});
if (process.env.NODE_ENV !== 'production') {
  InternalTypography.displayName = 'InternalTypography';
}
const Typography = /*#__PURE__*/React.forwardRef((props, ref) => {
  const {
    prefixCls: customizePrefixCls,
    className,
    rootClassName,
    direction: typographyDirection,
    classNames,
    styles,
    ...restProps
  } = props;
  const [mergedClassNames, mergedStyles, mergedPrefixCls, mergedDirection] = (0, _useTypographySemantic.useTypographySemantic)(customizePrefixCls, classNames, styles, typographyDirection, props);
  return /*#__PURE__*/React.createElement(InternalTypography, {
    ref: ref,
    className: (0, _clsx.clsx)(className, rootClassName),
    direction: mergedDirection,
    classNames: mergedClassNames,
    styles: mergedStyles,
    prefixCls: mergedPrefixCls,
    ...restProps
  });
});
if (process.env.NODE_ENV !== 'production') {
  Typography.displayName = 'Typography';
}
var _default = exports.default = Typography;