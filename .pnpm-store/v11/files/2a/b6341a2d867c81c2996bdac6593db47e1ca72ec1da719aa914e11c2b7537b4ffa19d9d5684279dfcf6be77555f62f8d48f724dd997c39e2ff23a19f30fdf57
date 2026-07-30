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
    viewBox: "0 0 24 24",
    width: size,
    xmlns: "http://www.w3.org/2000/svg"
  }, rest), {}, {
    children: [/*#__PURE__*/_jsx("title", {
      children: TITLE
    }), /*#__PURE__*/_jsx("path", {
      d: "M17.544 2.375c.017-.005 1.844-.5 2.712.361.872.872 1.588 1.642 1.588 1.642l-.565 1.38v-.003.006-.003L22 7.8c-.014.05-2.112 7.983-2.357 8.954-.488 1.924-.819 2.663-2.202 3.638a212.634 212.634 0 01-4.305 2.917c-.41.252-.92.691-1.383.691-.463 0-.974-.439-1.383-.691a213.099 213.099 0 01-4.306-2.917c-1.383-.975-1.72-1.714-2.2-3.632-.246-.977-2.35-8.904-2.364-8.96l.722-2.045-.566-1.383s.722-.764 1.594-1.63c.866-.872 2.712-.36 2.712-.36L8.066 0h7.373l2.105 2.375zm-5.797 12.557c-.138 0-1.04.318-1.762.691l-.457.234c-.487.253-.823.428-.956.506-.168.108-.066.306.09.414.15.103 2.195 1.684 2.394 1.865l.09.078c.186.168.432.391.607.391.174 0 .415-.223.607-.391l.084-.078c.2-.169 2.244-1.756 2.394-1.865.15-.108.258-.3.09-.408-.133-.084-.475-.253-.956-.506h-.006l-.457-.24c-.722-.373-1.623-.691-1.762-.691zm.006-11.276c-.35.02-.694.092-1.023.211l-.378.126c-.493.169-.969.331-1.21.331-.312 0-2.554-.428-2.584-.433 0 0-2.706 3.26-2.706 3.957 0 .577.228.805.504 1.07l.174.175 2.033 2.152.06.067c.204.204.5.498.29.998l-.043.102c-.228.535-.511 1.203-.15 1.876.384.716 1.046 1.19 1.467 1.118.42-.084 1.419-.601 1.78-.841.367-.229 1.52-1.19 1.521-1.551 0-.307-.829-.812-1.238-1.053l-.18-.12-.199-.12c-.367-.229-1.035-.644-1.047-.825-.018-.228-.017-.294.283-.853l.21-.379c.289-.487.602-1.029.536-1.426-.085-.433-.777-.685-1.36-.901l-.21-.078-.613-.229c-.583-.222-1.232-.463-1.34-.511-.145-.073-.11-.132.335-.174l.223-.025c.553-.06 1.582-.168 2.08-.03l.32.09c.564.145 1.25.337 1.316.445l.03.048c.067.09.109.145.037.53l-.121.607c-.15.806-.391 2.069-.421 2.351l-.012.115c-.042.312-.066.529.301.613.438.119.884.206 1.335.259.216 0 .824-.144 1.24-.24l.095-.025c.367-.078.343-.289.3-.602l-.011-.12c-.03-.282-.27-1.54-.42-2.345l-.122-.614c-.072-.384-.024-.439.036-.529l.03-.048c.067-.108.753-.294 1.318-.444l.318-.091c.5-.138 1.528-.03 2.081.03l.216.018c.451.048.493.108.343.18-.11.049-.758.29-1.341.512-.273.108-.547.21-.823.307-.583.216-1.275.468-1.36.907-.066.391.247.939.535 1.42l.21.379c.301.56.308.625.284.854-.012.18-.68.595-1.053.824l-.192.126-.181.108c-.41.247-1.238.758-1.238 1.059 0 .367 1.16 1.316 1.521 1.55.367.235 1.36.758 1.78.836.421.078 1.082-.396 1.467-1.112.36-.673.078-1.335-.15-1.876l-.042-.102c-.21-.5.084-.794.289-1.004l.065-.06 2.02-2.147.181-.181c.271-.265.505-.493.505-1.07 0-.698-2.706-3.957-2.706-3.957-.03.006-2.275.44-2.586.44l.007-.007c-.252 0-.722-.156-1.215-.337l-.379-.12c-.612-.21-1.02-.21-1.022-.21z"
    })]
  }));
});
export default Icon;