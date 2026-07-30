"use strict";
"use client";

var _interopRequireDefault = require("@babel/runtime/helpers/interopRequireDefault").default;
var _interopRequireWildcard = require("@babel/runtime/helpers/interopRequireWildcard").default;
Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
var React = _interopRequireWildcard(require("react"));
var _StarFilled = _interopRequireDefault(require("@ant-design/icons/StarFilled"));
var _rate = _interopRequireDefault(require("@rc-component/rate"));
var _clsx = require("clsx");
var _is = require("../_util/is");
var _context = require("../config-provider/context");
var _DisabledContext = _interopRequireDefault(require("../config-provider/DisabledContext"));
var _useSize = _interopRequireDefault(require("../config-provider/hooks/useSize"));
var _tooltip = _interopRequireDefault(require("../tooltip"));
var _style = _interopRequireDefault(require("./style"));
const Rate = /*#__PURE__*/React.forwardRef((props, ref) => {
  const {
    prefixCls,
    className,
    rootClassName,
    style,
    tooltips,
    character = /*#__PURE__*/React.createElement(_StarFilled.default, null),
    disabled: customDisabled,
    size,
    ...rest
  } = props;
  const characterRender = (node, {
    index = 0
  }) => {
    if (!tooltips) {
      return node;
    }
    const tooltipsItem = tooltips[index];
    if ((0, _is.isPlainObject)(tooltipsItem)) {
      return /*#__PURE__*/React.createElement(_tooltip.default, {
        ...tooltipsItem
      }, node);
    }
    return /*#__PURE__*/React.createElement(_tooltip.default, {
      title: tooltipsItem
    }, node);
  };
  const {
    getPrefixCls,
    direction,
    className: contextClassName,
    style: contextStyle
  } = (0, _context.useComponentConfig)('rate');
  const ratePrefixCls = getPrefixCls('rate', prefixCls);
  // Style
  const [hashId, cssVarCls] = (0, _style.default)(ratePrefixCls);
  const mergedStyle = {
    ...contextStyle,
    ...style
  };
  // ===================== Disabled =====================
  const disabled = React.useContext(_DisabledContext.default);
  const mergedDisabled = customDisabled ?? disabled;
  // ===================== Size =====================
  const mergedSize = (0, _useSize.default)(ctx => size ?? ctx);
  return /*#__PURE__*/React.createElement(_rate.default, {
    ref: ref,
    character: character,
    characterRender: characterRender,
    disabled: mergedDisabled,
    ...rest,
    className: (0, _clsx.clsx)({
      [`${ratePrefixCls}-large`]: mergedSize === 'large',
      [`${ratePrefixCls}-small`]: mergedSize === 'small'
    }, className, rootClassName, hashId, cssVarCls, contextClassName),
    style: mergedStyle,
    prefixCls: ratePrefixCls,
    direction: direction
  });
});
if (process.env.NODE_ENV !== 'production') {
  Rate.displayName = 'Rate';
}
var _default = exports.default = Rate;