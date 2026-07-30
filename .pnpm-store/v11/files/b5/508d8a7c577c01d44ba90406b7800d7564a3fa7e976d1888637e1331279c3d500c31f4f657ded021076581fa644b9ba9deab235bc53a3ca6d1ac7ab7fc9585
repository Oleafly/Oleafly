function _typeof(o) { "@babel/helpers - typeof"; return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function (o) { return typeof o; } : function (o) { return o && "function" == typeof Symbol && o.constructor === Symbol && o !== Symbol.prototype ? "symbol" : typeof o; }, _typeof(o); }
function ownKeys(e, r) { var t = Object.keys(e); if (Object.getOwnPropertySymbols) { var o = Object.getOwnPropertySymbols(e); r && (o = o.filter(function (r) { return Object.getOwnPropertyDescriptor(e, r).enumerable; })), t.push.apply(t, o); } return t; }
function _objectSpread(e) { for (var r = 1; r < arguments.length; r++) { var t = null != arguments[r] ? arguments[r] : {}; r % 2 ? ownKeys(Object(t), !0).forEach(function (r) { _defineProperty(e, r, t[r]); }) : Object.getOwnPropertyDescriptors ? Object.defineProperties(e, Object.getOwnPropertyDescriptors(t)) : ownKeys(Object(t)).forEach(function (r) { Object.defineProperty(e, r, Object.getOwnPropertyDescriptor(t, r)); }); } return e; }
function _defineProperty(obj, key, value) { key = _toPropertyKey(key); if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { obj[key] = value; } return obj; }
function _toPropertyKey(t) { var i = _toPrimitive(t, "string"); return "symbol" == _typeof(i) ? i : String(i); }
function _toPrimitive(t, r) { if ("object" != _typeof(t) || !t) return t; var e = t[Symbol.toPrimitive]; if (void 0 !== e) { var i = e.call(t, r || "default"); if ("object" != _typeof(i)) return i; throw new TypeError("@@toPrimitive must return a primitive value."); } return ("string" === r ? String : Number)(t); }
import { Center } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { memo } from 'react';
import DefaultIcon from "./DefaultIcon";
import { jsx as _jsx } from "react/jsx-runtime";
var DefaultAvatar = /*#__PURE__*/memo(function (_ref) {
  var _ref$shape = _ref.shape,
    shape = _ref$shape === void 0 ? 'circle' : _ref$shape,
    color = _ref.color,
    background = _ref.background,
    size = _ref.size,
    style = _ref.style,
    _ref$iconMultiple = _ref.iconMultiple,
    iconMultiple = _ref$iconMultiple === void 0 ? 0.6 : _ref$iconMultiple,
    iconStyle = _ref.iconStyle,
    iconClassName = _ref.iconClassName;
  return /*#__PURE__*/_jsx(Center, {
    flex: 'none',
    style: _objectSpread({
      background: background || cssVar.colorFillSecondary,
      borderRadius: shape === 'circle' ? '50%' : Math.floor(size * 0.1),
      color: color,
      height: size,
      width: size
    }, style),
    children: /*#__PURE__*/_jsx(DefaultIcon, {
      className: iconClassName,
      color: color,
      size: size * iconMultiple,
      style: iconStyle
    })
  });
});
export default DefaultAvatar;