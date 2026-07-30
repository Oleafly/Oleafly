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
    viewBox: "0 0 73 24",
    xmlns: "http://www.w3.org/2000/svg"
  }, rest), {}, {
    children: [/*#__PURE__*/_jsx("title", {
      children: TITLE
    }), /*#__PURE__*/_jsx("path", {
      d: "M2 .365h3.887L11.73 14.74 17.47.365h3.808v18.261h-2.895V5.191l-5.479 13.435h-2.53L4.896 5.191v13.435H2V.366zM28.17 18.783c-2.922 0-4.878-1.435-4.878-3.913 0-2.74 1.982-4.279 5.739-4.279h3.34v-.808c0-1.487-1.07-2.4-2.923-2.4-1.67 0-2.79.782-3 1.956h-2.765c.287-2.609 2.53-4.226 5.896-4.226 3.548 0 5.582 1.696 5.582 4.852v8.661H32.71l-.235-1.904c-.913 1.2-2.19 2.06-4.304 2.06zm-2.009-4.096c0 1.122.94 1.904 2.479 1.904 2.348 0 3.704-1.382 3.73-3.443v-.47h-3.496c-1.747 0-2.713.652-2.713 2.009zM40.175 19.357c.34 1.486 1.644 2.347 3.627 2.347 2.452 0 3.834-1.174 3.834-3.73v-1.487c-.886 1.33-2.27 2.191-4.356 2.191-3.626 0-6.313-2.53-6.313-6.782 0-4.096 2.687-6.783 6.313-6.783 2.087 0 3.521.913 4.383 2.244l.313-2.087h2.451v12.808c0 3.626-2.034 5.922-6.834 5.922-3.548 0-6.026-1.643-6.287-4.643h2.87zm-.313-7.461c0 2.608 1.54 4.408 3.887 4.408 2.348 0 3.887-1.8 3.887-4.356 0-2.635-1.539-4.461-3.887-4.461s-3.887 1.826-3.887 4.409zM52.92 5.27h2.817v13.356H52.92V5.27zm-.287-3.574C52.633.704 53.39 0 54.355 0s1.722.704 1.722 1.696c0 .991-.757 1.695-1.722 1.695s-1.722-.704-1.722-1.695zM64.368 18.783c-4.043 0-6.626-2.635-6.626-6.809 0-4.122 2.661-6.86 6.705-6.86 3.443 0 5.582 1.903 6.13 4.93H67.63c-.366-1.566-1.487-2.53-3.235-2.53-2.27 0-3.757 1.825-3.757 4.46 0 2.609 1.487 4.409 3.757 4.409 1.721 0 2.87-.992 3.209-2.53h2.973c-.522 3.025-2.79 4.93-6.209 4.93z"
    })]
  }));
});
export default Icon;