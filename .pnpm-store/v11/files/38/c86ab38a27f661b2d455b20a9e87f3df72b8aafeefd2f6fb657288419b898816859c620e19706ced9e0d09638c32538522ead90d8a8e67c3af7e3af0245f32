"use strict";
'use client';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
var React = _interopRequireWildcard(require("react"));
var _clsx = require("clsx");
var _Context = _interopRequireDefault(require("./Context"));
var _IconBase = _interopRequireDefault(require("./IconBase"));
function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }
function _getRequireWildcardCache(e) { if ("function" != typeof WeakMap) return null; var r = new WeakMap(), t = new WeakMap(); return (_getRequireWildcardCache = function (e) { return e ? t : r; })(e); }
function _interopRequireWildcard(e, r) { if (!r && e && e.__esModule) return e; if (null === e || "object" != typeof e && "function" != typeof e) return { default: e }; var t = _getRequireWildcardCache(r); if (t && t.has(e)) return t.get(e); var n = { __proto__: null }, a = Object.defineProperty && Object.getOwnPropertyDescriptor; for (var u in e) if ("default" !== u && Object.prototype.hasOwnProperty.call(e, u)) { var i = a ? Object.getOwnPropertyDescriptor(e, u) : null; i && (i.get || i.set) ? Object.defineProperty(n, u, i) : n[u] = e[u]; } return n.default = e, t && t.set(e, n), n; }
function _extends() { _extends = Object.assign ? Object.assign.bind() : function (target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i]; for (var key in source) { if (Object.prototype.hasOwnProperty.call(source, key)) { target[key] = source[key]; } } } return target; }; return _extends.apply(this, arguments); }
const Icon = /*#__PURE__*/React.forwardRef((props, ref) => {
  const {
    // affect outter <i>...</i>
    className,
    // affect inner <svg>...</svg>
    icon,
    spin,
    rotate,
    tabIndex,
    onClick,
    twoToneColor: _twoToneColor,
    // other
    ...restProps
  } = props;
  const {
    prefixCls = 'anticon',
    rootClassName
  } = React.useContext(_Context.default);
  const classString = (0, _clsx.clsx)(rootClassName, prefixCls, {
    [`${prefixCls}-${icon.name}`]: !!icon.name,
    [`${prefixCls}-spin`]: !!spin || icon.name === 'loading'
  }, className);
  let iconTabIndex = tabIndex;
  if (iconTabIndex === undefined && onClick) {
    iconTabIndex = -1;
  }
  const svgStyle = rotate ? {
    msTransform: `rotate(${rotate}deg)`,
    transform: `rotate(${rotate}deg)`
  } : undefined;
  return /*#__PURE__*/React.createElement("span", _extends({
    role: "img",
    "aria-label": icon.name
  }, restProps, {
    ref: ref,
    tabIndex: iconTabIndex,
    onClick: onClick,
    className: classString
  }), /*#__PURE__*/React.createElement(_IconBase.default, {
    icon: icon,
    style: svgStyle
  }));
});
if (process.env.NODE_ENV !== 'production') {
  Icon.displayName = 'AntdIcon';
}
var _default = exports.default = Icon;