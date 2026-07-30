"use strict";
"use client";

var _interopRequireDefault = require("@babel/runtime/helpers/interopRequireDefault").default;
var _interopRequireWildcard = require("@babel/runtime/helpers/interopRequireWildcard").default;
Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
var React = _interopRequireWildcard(require("react"));
var _clsx = require("clsx");
var _configProvider = require("../config-provider");
var _DisabledContext = _interopRequireDefault(require("../config-provider/DisabledContext"));
var _style = _interopRequireDefault(require("./style"));
const CheckableTag = /*#__PURE__*/React.forwardRef((props, ref) => {
  const {
    prefixCls: customizePrefixCls,
    style,
    className,
    checked,
    children,
    icon,
    onChange,
    onClick,
    onKeyDown,
    disabled: customDisabled,
    ...restProps
  } = props;
  const {
    getPrefixCls,
    tag
  } = React.useContext(_configProvider.ConfigContext);
  const disabled = React.useContext(_DisabledContext.default);
  const mergedDisabled = customDisabled ?? disabled;
  const handleClick = e => {
    if (mergedDisabled) {
      return;
    }
    onChange?.(!checked);
    onClick?.(e);
  };
  const handleKeyDown = e => {
    onKeyDown?.(e);
    if (e.defaultPrevented || mergedDisabled) {
      return;
    }
    if (e.key === ' ') {
      e.preventDefault();
      onChange?.(!checked);
    }
  };
  const prefixCls = getPrefixCls('tag', customizePrefixCls);
  // Style
  const [hashId, cssVarCls] = (0, _style.default)(prefixCls);
  const cls = (0, _clsx.clsx)(prefixCls, `${prefixCls}-checkable`, {
    [`${prefixCls}-checkable-checked`]: checked,
    [`${prefixCls}-checkable-disabled`]: mergedDisabled
  }, tag?.className, className, hashId, cssVarCls);
  return /*#__PURE__*/React.createElement("span", {
    ...restProps,
    ref: ref,
    role: "checkbox",
    "aria-checked": checked,
    "aria-disabled": mergedDisabled || undefined,
    tabIndex: mergedDisabled ? -1 : 0,
    style: {
      ...style,
      ...tag?.style
    },
    className: cls,
    onClick: handleClick,
    onKeyDown: handleKeyDown
  }, icon, /*#__PURE__*/React.createElement("span", null, children));
});
var _default = exports.default = CheckableTag;