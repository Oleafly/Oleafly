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
    viewBox: "0 0 91 24",
    xmlns: "http://www.w3.org/2000/svg"
  }, rest), {}, {
    children: [/*#__PURE__*/_jsx("title", {
      children: TITLE
    }), /*#__PURE__*/_jsx("path", {
      d: "M79.915 14.964l-5.53-7.548h3.33l3.88 5.256 3.88-5.256h3.24l-5.5 7.486 5.683 7.792h-3.361l-4.003-5.5-4.064 5.5H74.2l5.715-7.73zM66.368 23c-1.345 0-2.567-.326-3.667-.978-1.08-.652-1.935-1.579-2.567-2.78-.631-1.203-.947-2.608-.947-4.217 0-1.59.316-2.974.947-4.156.652-1.202 1.518-2.129 2.597-2.78 1.08-.652 2.272-.978 3.575-.978 1.813 0 3.33.55 4.553 1.65 1.222 1.1 1.956 2.597 2.2 4.491.082.693.112 1.477.092 2.353H62.09c.06 1.548.489 2.76 1.283 3.636.815.876 1.793 1.314 2.933 1.314h.184c.855 0 1.599-.224 2.23-.672.632-.448 1.06-1.06 1.284-1.833h2.933a6.147 6.147 0 01-2.322 3.575C69.433 22.54 68.018 23 66.368 23zm3.819-9.687c-.082-1.16-.469-2.077-1.161-2.75-.693-.692-1.558-1.038-2.597-1.038h-.214c-.978 0-1.844.315-2.597.947-.734.611-1.212 1.558-1.437 2.841h8.006zM47.834 23c-1.324 0-2.516-.326-3.575-.978-1.039-.652-1.854-1.579-2.444-2.78-.591-1.202-.887-2.598-.887-4.187 0-1.588.306-2.984.917-4.186.611-1.201 1.446-2.128 2.506-2.78 1.08-.652 2.281-.978 3.605-.978 1.08 0 2.047.224 2.903.672.855.449 1.497 1.019 1.925 1.711V1.306h2.903v21.388h-2.903v-2.108c-.408.672-1.06 1.242-1.956 1.711-.896.469-1.894.703-2.994.703zm.58-2.475c.856 0 1.62-.234 2.292-.703.672-.468 1.192-1.11 1.558-1.925.387-.835.58-1.782.58-2.841 0-1.06-.193-1.997-.58-2.812-.366-.835-.886-1.487-1.558-1.955a3.911 3.911 0 00-2.292-.703h-.183c-1.304 0-2.363.51-3.178 1.528-.794 1.018-1.191 2.332-1.191 3.941 0 1.61.397 2.924 1.191 3.942.815 1.019 1.874 1.528 3.178 1.528h.183zM31.022 23c-1.406 0-2.679-.337-3.82-1.009a7.367 7.367 0 01-2.688-2.841c-.652-1.223-.978-2.587-.978-4.095 0-1.507.326-2.862.978-4.064.651-1.222 1.548-2.17 2.688-2.841 1.141-.693 2.414-1.04 3.82-1.04 1.405 0 2.668.347 3.789 1.04 1.14.672 2.037 1.62 2.688 2.841.652 1.202.978 2.557.978 4.064 0 1.508-.326 2.872-.977 4.095a7.367 7.367 0 01-2.69 2.841C33.69 22.663 32.428 23 31.023 23zm.06-2.476c.857 0 1.62-.224 2.293-.672.672-.468 1.201-1.11 1.589-1.925.386-.835.58-1.792.58-2.872 0-1.08-.194-2.027-.58-2.841-.388-.836-.917-1.477-1.59-1.925a3.911 3.911 0 00-2.291-.703H30.9c-1.304 0-2.373.51-3.209 1.528-.814.998-1.222 2.312-1.222 3.941 0 1.63.407 2.954 1.222 3.972.835.998 1.905 1.497 3.209 1.497h.183zM12.053 23c-2.037 0-3.82-.469-5.348-1.406-1.507-.957-2.668-2.271-3.483-3.941S2 14.098 2 12c0-2.098.407-3.982 1.222-5.653.835-1.67 2.017-2.974 3.545-3.91C8.294 1.478 10.057 1 12.053 1c1.609 0 3.055.316 4.338.947 1.304.611 2.363 1.477 3.178 2.597.815 1.1 1.304 2.374 1.467 3.82h-3.117c-.244-1.365-.876-2.465-1.894-3.3-1.019-.856-2.302-1.283-3.85-1.283h-.245c-1.385 0-2.597.356-3.636 1.069-1.039.713-1.833 1.69-2.383 2.933-.55 1.243-.825 2.648-.825 4.217 0 1.568.275 2.974.825 4.216.55 1.243 1.344 2.22 2.383 2.934 1.04.713 2.251 1.07 3.636 1.07h.245c1.548 0 2.831-.418 3.85-1.254 1.039-.855 1.68-1.976 1.925-3.36h3.086c-.184 1.446-.683 2.729-1.497 3.85-.795 1.12-1.844 1.996-3.148 2.627-1.303.611-2.75.917-4.338.917z"
    })]
  }));
});
export default Icon;