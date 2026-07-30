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
    viewBox: "0 0 125 24",
    xmlns: "http://www.w3.org/2000/svg"
  }, rest), {}, {
    children: [/*#__PURE__*/_jsx("title", {
      children: TITLE
    }), /*#__PURE__*/_jsx("path", {
      d: "M2 23.503V.298h7.668c4.017 0 7.636 2.42 7.636 7.26 0 4.972-3.619 7.757-7.636 7.757H5.884v8.188H2zm3.884-11.835h3.784c1.727 0 3.752-1.226 3.752-3.845 0-2.652-2.025-3.878-3.752-3.878H5.884v7.723zM27.557 24c-4.846 0-8.564-3.978-8.564-8.818 0-4.873 3.718-8.85 8.564-8.85 2.69 0 4.714 1.425 5.976 3.414V6.829h3.651v16.674h-3.651v-2.917C32.27 22.575 30.246 24 27.557 24zm-4.913-8.818c0 2.95 2.357 5.172 5.445 5.172 3.087 0 5.444-2.188 5.444-5.172 0-3.016-2.357-5.204-5.444-5.204-3.088 0-5.445 2.22-5.445 5.204zm18.51 8.32V6.83h3.619v2.718c.863-1.757 2.39-2.95 4.98-2.95v3.68c-2.69-.167-4.98 1.06-4.98 4.905v8.32h-3.619zm18.66.498c-4.846 0-8.565-3.978-8.565-8.818 0-4.873 3.718-8.85 8.565-8.85 2.69 0 4.714 1.425 5.976 3.414V6.829h3.651v16.674H65.79v-2.917C64.528 22.575 62.503 24 59.814 24zm-4.913-8.818c0 2.95 2.357 5.172 5.444 5.172 3.088 0 5.445-2.188 5.445-5.172 0-3.016-2.357-5.204-5.445-5.204-3.087 0-5.444 2.22-5.444 5.204zM79.718 24c-3.087 0-6.24-1.392-7.303-3.348l2.59-2.155c.796 1.028 2.556 1.956 4.713 1.956 1.162 0 2.855-.398 2.855-1.823 0-1.425-1.892-1.459-3.751-1.89-4.017-.895-5.677-2.353-5.677-5.105 0-3.414 2.922-5.304 6.241-5.304a9.55 9.55 0 015.943 2.023l-1.76 2.85c-.963-.762-2.888-1.326-4.183-1.326-1.328 0-2.556.597-2.556 1.658 0 1.06.963 1.392 2.59 1.79 2.655.63 6.838 1.028 6.838 5.105 0 4.144-3.585 5.569-6.54 5.569zm17.605 0c-4.847 0-8.565-3.978-8.565-8.818 0-4.873 3.718-8.85 8.565-8.85 2.689 0 4.714 1.425 5.975 3.414V6.829h3.652v16.674h-3.652v-2.917C102.037 22.575 100.012 24 97.323 24zm-4.913-8.818c0 2.95 2.357 5.172 5.444 5.172 3.087 0 5.444-2.188 5.444-5.172 0-3.016-2.357-5.204-5.444-5.204-3.087 0-5.444 2.22-5.444 5.204zm18.941 8.32V6.83h3.618v16.674h-3.618zm-.431-21.281c0-1.227.995-2.221 2.224-2.221 1.228 0 2.224.994 2.224 2.221a2.223 2.223 0 01-2.224 2.221 2.222 2.222 0 01-2.224-2.221zm8.428 21.282V.298H123v23.205h-3.652z"
    })]
  }));
});
export default Icon;