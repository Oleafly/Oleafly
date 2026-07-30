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
      clipRule: "evenodd",
      d: "M10.853 6.285c.141-.972.455-2.221.942-3.747l.205-.63.206.63c.486 1.526.8 2.775.942 3.748.108.713.108 1.62 0 2.72-.109 1.105-.109 2.019 0 2.741a4.218 4.218 0 001.452 2.635 4.224 4.224 0 002.855 1.07c1.2 0 2.224-.423 3.074-1.268.846-.845 1.273-1.865 1.282-3.06.005-1.058.114-2.225.326-3.5.104-.637.21-1.17.319-1.6l.142-.581.255.538A11.88 11.88 0 0124 10.883v.24c0 1.63-.314 3.186-.942 4.669a12.017 12.017 0 01-6.39 6.39 11.848 11.848 0 01-4.668.942c-1.629 0-3.185-.314-4.668-.942a12.016 12.016 0 01-6.39-6.39A11.848 11.848 0 010 11.124v-.241A11.881 11.881 0 011.148 5.98l.255-.538.141.58c.11.43.215.964.32 1.601.212 1.275.32 2.442.325 3.5.01 1.195.437 2.215 1.282 3.06.85.845 1.875 1.268 3.075 1.268a4.225 4.225 0 002.854-1.07 4.218 4.218 0 001.453-2.635c.108-.722.108-1.636 0-2.741-.109-1.1-.109-2.007 0-2.72zM12 20.936a9.651 9.651 0 004.661-1.176 9.643 9.643 0 002.677-2.113c.095-.107-.017-.27-.154-.232a6.574 6.574 0 01-1.73.227 6.402 6.402 0 01-3.293-.893c-.82-.478-1.5-1.099-2.04-1.862a.149.149 0 00-.242 0 6.427 6.427 0 01-2.04 1.862 6.402 6.402 0 01-3.293.893 6.574 6.574 0 01-1.73-.227c-.137-.037-.248.125-.154.232a9.643 9.643 0 002.677 2.113A9.651 9.651 0 0012 20.935z"
    })]
  }));
});
export default Icon;