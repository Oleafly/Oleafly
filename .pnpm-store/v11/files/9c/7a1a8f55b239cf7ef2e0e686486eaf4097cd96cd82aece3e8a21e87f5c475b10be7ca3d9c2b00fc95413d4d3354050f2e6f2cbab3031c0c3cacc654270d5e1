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
      d: "M6.98 2c2.351.265 3.905 1.955 3.987 4.31a.035.035 0 00.019.031.036.036 0 00.036-.001c5.432-3.05 12.168.3 12.921 6.48.31 2.535-.668 5.04-2.33 6.946-1.41 1.619-3.653 2.561-5.763 2.738h-.996c-3.945-.28-7.106-2.99-7.99-6.805a.302.302 0 00-.078-.145l.013-.027a.114.114 0 00.01-.055l-.162-2.05.014-8.569L6.666 2h.314zm14.102 17.852c-.32-.386-.527-.643-.62-.773-.74-1.011-1.058-2.195-.952-3.552.044-.57.296-1.117.263-1.744-.146-2.74-2.503-4.64-5.21-4.232-1.772.268-3.215 1.678-3.61 3.4a4.44 4.44 0 001.574 4.488c1.119.879 2.37 1.166 3.753.86.675-.15 1.04-.226 1.096-.23 1.126-.083 2.098.273 2.918 1.069.486.472.74.718.763.738a.017.017 0 00.024 0 .017.017 0 000-.024z",
      fill: "#006EFF"
    }), /*#__PURE__*/_jsx("path", {
      d: "M6.661 4.854l-.014 8.568-2.921-5.847-1.488-3.048a.106.106 0 01.022-.124.11.11 0 01.037-.024c1.57-.602 3.025-.444 4.364.475z",
      fill: "#A5CCFF"
    }), /*#__PURE__*/_jsx("path", {
      d: "M3.726 7.575l2.921 5.847.161 2.05a.114.114 0 01-.01.055l-.012.027L.02 8.821a.07.07 0 01.001-.1C1.064 7.747 2.3 7.365 3.726 7.576z",
      fill: "#A5CCFF",
      fillOpacity: ".647"
    })]
  }));
});
export default Icon;