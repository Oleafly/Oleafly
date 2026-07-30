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
    viewBox: "0 0 101 24",
    xmlns: "http://www.w3.org/2000/svg"
  }, rest), {}, {
    children: [/*#__PURE__*/_jsx("title", {
      children: TITLE
    }), /*#__PURE__*/_jsx("path", {
      d: "M8.38 3.21l-3.347 9.132h6.68L8.38 3.211zm5.534 15.172l-1.239-3.343H4.071l-1.238 3.343H0L6.68 0h3.413l6.706 18.382h-2.885zm14.503-6.935c0-1.219-.443-2.272-1.33-3.158-.887-.885-1.946-1.328-3.176-1.328-1.23 0-2.288.443-3.175 1.328-.878.878-1.318 1.93-1.318 3.158 0 1.237.44 2.294 1.318 3.171.878.878 1.937 1.316 3.175 1.316 1.239 0 2.297-.438 3.176-1.316.887-.886 1.33-1.943 1.33-3.17zm2.701 5.395c0 1.948-.711 3.623-2.134 5.027C27.57 23.288 25.879 24 23.911 24a6.945 6.945 0 01-3.478-.934 7.317 7.317 0 01-1.476-1.092 8.05 8.05 0 01-1.186-1.408l2.28-1.487c.984 1.482 2.27 2.224 3.86 2.224 1.335 0 2.403-.439 3.202-1.316.747-.825 1.173-1.904 1.278-3.237-1.335 1.237-2.903 1.855-4.704 1.855-1.932 0-3.579-.706-4.94-2.118-1.353-1.404-2.03-3.083-2.03-5.04 0-1.965.707-3.653 2.122-5.065 1.431-1.413 3.122-2.119 5.072-2.119 1.968 0 3.659.706 5.073 2.119 1.423 1.412 2.134 3.1 2.134 5.065v5.395zm11.698 1.54v-8.053c0-.912-.334-1.702-1.002-2.368-.667-.667-1.458-1-2.371-1-.914 0-1.704.333-2.372 1-.667.666-1.001 1.456-1.001 2.368v8.053h-2.701v-8.053c0-1.605.61-3.018 1.831-4.237 1.221-1.22 2.636-1.829 4.243-1.829 1.599 0 3.008.61 4.23 1.83 1.229 1.227 1.844 2.64 1.844 4.236v8.053h-2.701zM57.254 7.987c-.861-.684-1.818-1.026-2.872-1.026-1.248 0-2.306.443-3.176 1.328-.87.886-1.304 1.948-1.304 3.185 0 .35.061.736.184 1.158l7.168-4.645zm4.348 3.276c-.009 2.026-.703 3.759-2.082 5.198-1.37 1.43-3.07 2.144-5.099 2.144-2.003 0-3.707-.688-5.112-2.066-1.405-1.377-2.108-3.065-2.108-5.065 0-1.983.698-3.68 2.095-5.092 1.396-1.413 3.092-2.119 5.086-2.119 1.458 0 2.788.404 3.992 1.21 1.203.808 2.103 1.891 2.7 3.25l-9.525 6.185c.852.684 1.81 1.026 2.872 1.026 1.283 0 2.341-.456 3.175-1.368.844-.921 1.27-2.022 1.279-3.303h2.727zM72.179 14.5c0 1.14-.413 2.11-1.238 2.908-.826.798-1.805 1.197-2.938 1.197-1.002 0-1.88-.311-2.635-.934-.756-.631-1.243-1.447-1.463-2.447l2.609-.698c.175.939.672 1.408 1.489 1.408.386 0 .733-.14 1.04-.42.308-.29.462-.628.462-1.014 0-.64-.488-1.171-1.463-1.592a84.566 84.566 0 01-1.858-.855c-.448-.22-.733-.378-.856-.474-.975-.72-1.463-1.768-1.463-3.145 0-1.123.409-2.1 1.226-2.934.825-.825 1.81-1.237 2.951-1.237 1.001 0 1.88.32 2.635.96.72.623 1.2 1.435 1.436 2.435l-2.635.684c-.202-.92-.68-1.381-1.436-1.381-.395 0-.742.149-1.04.447-.3.298-.449.64-.449 1.026 0 .632.488 1.163 1.463 1.592a29.78 29.78 0 011.818.842c.448.22.742.382.883.487.975.737 1.462 1.785 1.462 3.145zM88.841 3.21l-3.346 9.132h6.68L88.84 3.211zm5.534 15.172l-1.238-3.343h-8.604l-1.239 3.343h-2.832L87.142 0h3.412l6.707 18.382h-2.886zm3.937 0V0H101v18.382h-2.688z"
    })]
  }));
});
export default Icon;