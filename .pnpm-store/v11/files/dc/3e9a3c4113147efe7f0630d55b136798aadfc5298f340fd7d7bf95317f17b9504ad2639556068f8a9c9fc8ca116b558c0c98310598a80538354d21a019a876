'use client';

function _typeof(o) { "@babel/helpers - typeof"; return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function (o) { return typeof o; } : function (o) { return o && "function" == typeof Symbol && o.constructor === Symbol && o !== Symbol.prototype ? "symbol" : typeof o; }, _typeof(o); }
var _excluded = ["size", "style"];
function ownKeys(e, r) { var t = Object.keys(e); if (Object.getOwnPropertySymbols) { var o = Object.getOwnPropertySymbols(e); r && (o = o.filter(function (r) { return Object.getOwnPropertyDescriptor(e, r).enumerable; })), t.push.apply(t, o); } return t; }
function _objectSpread(e) { for (var r = 1; r < arguments.length; r++) { var t = null != arguments[r] ? arguments[r] : {}; r % 2 ? ownKeys(Object(t), !0).forEach(function (r) { _defineProperty(e, r, t[r]); }) : Object.getOwnPropertyDescriptors ? Object.defineProperties(e, Object.getOwnPropertyDescriptors(t)) : ownKeys(Object(t)).forEach(function (r) { Object.defineProperty(e, r, Object.getOwnPropertyDescriptor(t, r)); }); } return e; }
function _defineProperty(obj, key, value) { key = _toPropertyKey(key); if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { obj[key] = value; } return obj; }
function _toPropertyKey(t) { var i = _toPrimitive(t, "string"); return "symbol" == _typeof(i) ? i : String(i); }
function _toPrimitive(t, r) { if ("object" != _typeof(t) || !t) return t; var e = t[Symbol.toPrimitive]; if (void 0 !== e) { var i = e.call(t, r || "default"); if ("object" != _typeof(i)) return i; throw new TypeError("@@toPrimitive must return a primitive value."); } return ("string" === r ? String : Number)(t); }
function _objectWithoutProperties(source, excluded) { if (source == null) return {}; var target = _objectWithoutPropertiesLoose(source, excluded); var key, i; if (Object.getOwnPropertySymbols) { var sourceSymbolKeys = Object.getOwnPropertySymbols(source); for (i = 0; i < sourceSymbolKeys.length; i++) { key = sourceSymbolKeys[i]; if (excluded.indexOf(key) >= 0) continue; if (!Object.prototype.propertyIsEnumerable.call(source, key)) continue; target[key] = source[key]; } } return target; }
function _objectWithoutPropertiesLoose(source, excluded) { if (source == null) return {}; var target = {}; var sourceKeys = Object.keys(source); var key, i; for (i = 0; i < sourceKeys.length; i++) { key = sourceKeys[i]; if (excluded.indexOf(key) >= 0) continue; target[key] = source[key]; } return target; }
import { memo } from 'react';
import { TITLE } from "../style";
import { jsx as _jsx } from "react/jsx-runtime";
import { jsxs as _jsxs } from "react/jsx-runtime";
var Icon = /*#__PURE__*/memo(function (_ref) {
  var _ref$size = _ref.size,
    size = _ref$size === void 0 ? '1em' : _ref$size,
    style = _ref.style,
    rest = _objectWithoutProperties(_ref, _excluded);
  return /*#__PURE__*/_jsxs("svg", _objectSpread(_objectSpread({
    fill: "currentColor",
    fillRule: "evenodd",
    height: size,
    style: _objectSpread({
      flex: 'none',
      lineHeight: 1
    }, style),
    viewBox: "0 0 54 24",
    xmlns: "http://www.w3.org/2000/svg"
  }, rest), {}, {
    children: [/*#__PURE__*/_jsx("title", {
      children: TITLE
    }), /*#__PURE__*/_jsx("path", {
      d: "M44.055 2C48.405 2 52 5.114 52 10.002c0 5.149-3.66 8.838-8.39 8.838-1.668 0-3.186-.311-4.435-1.015a6.072 6.072 0 01-2.443-2.53l-1.212 8.492-.03.213h-2.447l.041-.285 3.087-21.269h2.424l-.256 1.581C39.801 2.69 41.772 2 44.055 2zm-33.666.028c1.668 0 3.193.312 4.45 1.018a6.084 6.084 0 012.454 2.546l.409-2.932.03-.214h2.419l-2.264 15.763-.03.213h-2.42l.234-1.604c-1.45 1.359-3.443 2.05-5.726 2.05-4.35 0-7.945-3.114-7.945-8.002 0-5.149 3.66-8.838 8.39-8.838zm12.292 16.394h-2.42L22.555 2.66l.03-.213h2.417l-2.32 15.976zm4.354 0h-2.419L26.91 2.66l.03-.213h2.417l-2.32 15.976zM33.71 2.446l-2.32 15.976h-2.42L31.264 2.66l.03-.213h2.417zM10.64 4.143c-3.675 0-6.143 2.932-6.143 6.612 0 1.58.498 3.08 1.48 4.181.976 1.097 2.449 1.817 4.44 1.817 3.674 0 6.143-2.959 6.143-6.64 0-1.78-.617-3.27-1.657-4.314-1.04-1.043-2.517-1.656-4.264-1.656zm32.942-.027c-3.673 0-6.142 2.958-6.142 6.639 0 1.78.617 3.27 1.657 4.313 1.04 1.044 2.517 1.657 4.263 1.657 3.675 0 6.143-2.932 6.143-6.611 0-1.581-.498-3.081-1.479-4.182-.977-1.097-2.45-1.817-4.442-1.817z"
    })]
  }));
});
export default Icon;