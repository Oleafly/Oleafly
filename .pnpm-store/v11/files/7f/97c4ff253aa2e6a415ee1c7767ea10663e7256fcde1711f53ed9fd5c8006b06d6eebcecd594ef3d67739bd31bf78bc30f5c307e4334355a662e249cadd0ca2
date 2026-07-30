'use client';

function _typeof(o) { "@babel/helpers - typeof"; return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function (o) { return typeof o; } : function (o) { return o && "function" == typeof Symbol && o.constructor === Symbol && o !== Symbol.prototype ? "symbol" : typeof o; }, _typeof(o); }
var _excluded = ["shape", "color", "background", "size", "style", "iconMultiple", "Icon", "iconStyle", "iconClassName"];
function ownKeys(e, r) { var t = Object.keys(e); if (Object.getOwnPropertySymbols) { var o = Object.getOwnPropertySymbols(e); r && (o = o.filter(function (r) { return Object.getOwnPropertyDescriptor(e, r).enumerable; })), t.push.apply(t, o); } return t; }
function _objectSpread(e) { for (var r = 1; r < arguments.length; r++) { var t = null != arguments[r] ? arguments[r] : {}; r % 2 ? ownKeys(Object(t), !0).forEach(function (r) { _defineProperty(e, r, t[r]); }) : Object.getOwnPropertyDescriptors ? Object.defineProperties(e, Object.getOwnPropertyDescriptors(t)) : ownKeys(Object(t)).forEach(function (r) { Object.defineProperty(e, r, Object.getOwnPropertyDescriptor(t, r)); }); } return e; }
function _defineProperty(obj, key, value) { key = _toPropertyKey(key); if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { obj[key] = value; } return obj; }
function _toPropertyKey(t) { var i = _toPrimitive(t, "string"); return "symbol" == _typeof(i) ? i : String(i); }
function _toPrimitive(t, r) { if ("object" != _typeof(t) || !t) return t; var e = t[Symbol.toPrimitive]; if (void 0 !== e) { var i = e.call(t, r || "default"); if ("object" != _typeof(i)) return i; throw new TypeError("@@toPrimitive must return a primitive value."); } return ("string" === r ? String : Number)(t); }
function _objectWithoutProperties(source, excluded) { if (source == null) return {}; var target = _objectWithoutPropertiesLoose(source, excluded); var key, i; if (Object.getOwnPropertySymbols) { var sourceSymbolKeys = Object.getOwnPropertySymbols(source); for (i = 0; i < sourceSymbolKeys.length; i++) { key = sourceSymbolKeys[i]; if (excluded.indexOf(key) >= 0) continue; if (!Object.prototype.propertyIsEnumerable.call(source, key)) continue; target[key] = source[key]; } } return target; }
function _objectWithoutPropertiesLoose(source, excluded) { if (source == null) return {}; var target = {}; var sourceKeys = Object.keys(source); var key, i; for (i = 0; i < sourceKeys.length; i++) { key = sourceKeys[i]; if (excluded.indexOf(key) >= 0) continue; target[key] = source[key]; } return target; }
import { Center } from '@lobehub/ui';
import { useThemeMode } from 'antd-style';
import { memo } from 'react';
import { getAvatarShadow } from "./util";
import { jsx as _jsx } from "react/jsx-runtime";
var IconAvatar = /*#__PURE__*/memo(function (_ref) {
  var _ref$shape = _ref.shape,
    shape = _ref$shape === void 0 ? 'circle' : _ref$shape,
    _ref$color = _ref.color,
    color = _ref$color === void 0 ? '#fff' : _ref$color,
    background = _ref.background,
    size = _ref.size,
    style = _ref.style,
    _ref$iconMultiple = _ref.iconMultiple,
    iconMultiple = _ref$iconMultiple === void 0 ? 0.75 : _ref$iconMultiple,
    Icon = _ref.Icon,
    iconStyle = _ref.iconStyle,
    iconClassName = _ref.iconClassName,
    rest = _objectWithoutProperties(_ref, _excluded);
  var _useThemeMode = useThemeMode(),
    isDarkMode = _useThemeMode.isDarkMode;
  return /*#__PURE__*/_jsx(Center, _objectSpread(_objectSpread({
    flex: 'none',
    style: _objectSpread({
      background: background,
      borderRadius: shape === 'circle' ? '50%' : Math.floor(size * 0.1),
      boxShadow: getAvatarShadow(isDarkMode, background),
      color: color,
      height: size,
      overflow: 'hidden',
      width: size
    }, style)
  }, rest), {}, {
    children: Icon && /*#__PURE__*/_jsx(Icon, {
      className: iconClassName,
      color: color,
      size: size,
      style: _objectSpread({
        transform: "scale(".concat(iconMultiple, ")")
      }, iconStyle)
    })
  }));
});
export default IconAvatar;