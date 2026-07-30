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
    viewBox: "0 0 60 24",
    xmlns: "http://www.w3.org/2000/svg"
  }, rest), {}, {
    children: [/*#__PURE__*/_jsx("title", {
      children: TITLE
    }), /*#__PURE__*/_jsx("path", {
      d: "M2 21.667h4.26v-9.02c0-2.962 1.798-4.26 3.828-4.26 1.997 0 3.561 1.332 3.561 4.06v9.22h4.26V11.582c0-4.36-2.53-6.89-6.49-6.89-2.496 0-3.894 1-4.893 2.297H6.26l-.366-1.963H2v16.641zM34.215 10.45v-.199c1.465-.732 2.93-1.997 2.93-4.493C37.144 2.163 34.18 0 30.087 0c-4.194 0-7.19 2.297-7.19 5.824 0 2.397 1.399 3.695 2.93 4.427v.2a5.653 5.653 0 00-3.728 5.392C22.1 19.47 25.095 22 30.054 22c4.96 0 7.855-2.53 7.855-6.157 0-2.996-1.997-4.76-3.694-5.392zm-4.16-7.388c1.664 0 2.895 1.065 2.895 2.862 0 1.798-1.265 2.863-2.896 2.863-1.63 0-2.995-1.065-2.995-2.863 0-1.83 1.298-2.862 2.995-2.862zm0 15.743c-1.931 0-3.495-1.232-3.495-3.329 0-1.897 1.298-3.328 3.46-3.328 2.132 0 3.43 1.398 3.43 3.395 0 2.03-1.498 3.262-3.396 3.262zM42.237 21.667h4.26v-9.02c0-2.962 1.797-4.26 3.828-4.26 1.997 0 3.56 1.332 3.56 4.06v9.22h4.261V11.582c0-4.36-2.53-6.89-6.49-6.89-2.496 0-3.894 1-4.893 2.297h-.266l-.366-1.963h-3.894v16.641z"
    })]
  }));
});
export default Icon;