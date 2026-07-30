"use strict";
"use client";

var _interopRequireWildcard = require("@babel/runtime/helpers/interopRequireWildcard").default;
Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = exports.InternalPanel = void 0;
var _react = _interopRequireWildcard(require("react"));
var _clsx = require("clsx");
const InternalPanel = exports.InternalPanel = /*#__PURE__*/(0, _react.forwardRef)((props, ref) => {
  const {
    prefixCls,
    className,
    children,
    destroyOnHidden = false,
    size,
    style,
    supportMotion
  } = props;
  const isCollapsed = size === 0 || typeof size === 'string' && Number.parseFloat(size) === 0;
  const panelClassName = (0, _clsx.clsx)(`${prefixCls}-panel`, {
    [`${prefixCls}-panel-hidden`]: isCollapsed,
    [`${prefixCls}-panel-transition`]: supportMotion
  }, className);
  const hasSize = size !== undefined;
  return /*#__PURE__*/_react.default.createElement("div", {
    ref: ref,
    className: panelClassName,
    style: {
      ...style,
      // Use auto when start from ssr
      flexBasis: hasSize ? size : 'auto',
      flexGrow: hasSize ? 0 : 1
    }
  }, !(destroyOnHidden && isCollapsed) && children);
});
if (process.env.NODE_ENV !== 'production') {
  InternalPanel.displayName = 'Panel';
}
const Panel = () => null;
var _default = exports.default = Panel;