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
    viewBox: "0 0 175 24",
    xmlns: "http://www.w3.org/2000/svg"
  }, rest), {}, {
    children: [/*#__PURE__*/_jsx("title", {
      children: TITLE
    }), /*#__PURE__*/_jsx("path", {
      d: "M11.5 5.904c0-1.92-1.232-3.066-2.977-3.066-1.488 0-2.833 1.345-2.833 2.89 0 1.546 1.003 2.349 3.066 3.005 4.582 1.46 6.27 3.18 6.27 6.846 0 3.665-2.748 6.413-6.499 6.413-3.75 0-6.47-2.691-6.527-6.67h3.095c.028 2.291 1.373 3.836 3.436 3.836 2.063 0 3.409-1.488 3.409-3.58 0-1.545-.69-2.52-2.948-3.294-5.239-1.773-6.385-3.494-6.385-6.499C2.607 2.548 5.27 0 8.536 0c3.494 0 6.013 2.206 6.07 5.9h-3.094l-.012.004zM31.433 21.596v-2.462h-.058c-1.117 1.891-3.123 2.862-5.381 2.862-4.64 0-8.42-3.494-8.42-8.077 0-5.068 3.637-8.619 8.305-8.619 2.32 0 4.265.86 5.496 2.662h.058V5.728h2.976v15.864h-2.976v.004zm.057-7.901c0-3.095-2.235-5.671-5.525-5.671-2.976 0-5.41 2.548-5.41 5.67 0 3.124 2.434 5.586 5.41 5.586s5.525-2.576 5.525-5.585zM58.908 21.596V12.72c0-3.004-1.26-4.696-3.75-4.696-2.635 0-3.78 1.46-3.78 4.64v8.932H48.4v-9.218c0-3.123-1.46-4.35-3.608-4.35-2.634 0-3.922 1.545-3.922 4.668V21.6h-2.976V5.732h2.748V7.45h.057C41.988 5.932 43.19 5.3 45.254 5.3c2.063 0 4.122 1.003 4.925 2.662 1.146-1.802 2.72-2.662 5.24-2.662 4.121 0 6.47 2.577 6.47 6.67v9.622h-2.977l-.004.004zM65.346 21.596V.408h2.976v7.53h.057c1.288-1.745 3.294-2.634 5.439-2.634 4.497 0 8.22 3.78 8.22 8.362 0 4.583-3.495 8.334-7.963 8.334-2.291 0-4.412-.917-5.728-2.69h-.057v2.29h-2.948l.004-.004zm13.715-7.93c0-3.004-2.377-5.642-5.439-5.642-3.062 0-5.381 2.576-5.381 5.585 0 3.01 2.377 5.672 5.41 5.672 3.033 0 5.41-2.52 5.41-5.615zM97.575 21.596v-2.462h-.057c-1.117 1.891-3.123 2.862-5.382 2.862-4.64 0-8.419-3.494-8.419-8.077 0-5.068 3.637-8.619 8.305-8.619 2.32 0 4.265.86 5.496 2.662h.057V5.728h2.976v15.864h-2.976v.004zm.057-7.901c0-3.095-2.234-5.671-5.524-5.671-2.977 0-5.41 2.548-5.41 5.67 0 3.124 2.434 5.586 5.41 5.586s5.524-2.576 5.524-5.585zM117.855 21.596L107.372 5.22h-.057v16.377h-3.09V.408h3.38l10.307 16.12h.057V.409h3.09v21.188h-3.208.004zM132.304 21.996c-4.469 0-8.448-3.808-8.448-8.277 0-4.84 3.808-8.419 8.676-8.419 4.383 0 8.505 3.437 8.448 8.476-.057 4.236-3.608 8.22-8.676 8.22zm.086-13.972c-2.977 0-5.558 2.52-5.558 5.614s2.492 5.642 5.496 5.642c3.005 0 5.668-2.462 5.668-5.67 0-3.21-2.492-5.586-5.611-5.586h.005zM147.41 21.596l-6.3-15.864h3.181l4.15 11.339h.057l4.065-11.339h3.18l-6.242 15.864h-2.091zM169.785 21.596v-2.462h-.057c-1.118 1.891-3.124 2.862-5.382 2.862-4.64 0-8.419-3.494-8.419-8.077 0-5.068 3.636-8.619 8.305-8.619 2.319 0 4.264.86 5.496 2.662h.057V5.728h2.976v15.864h-2.976v.004zm.057-7.901c0-3.095-2.235-5.671-5.525-5.671-2.976 0-5.41 2.548-5.41 5.67 0 3.124 2.434 5.586 5.41 5.586 2.977 0 5.525-2.576 5.525-5.585z"
    })]
  }));
});
export default Icon;