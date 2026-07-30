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
    viewBox: "0 0 71 24",
    xmlns: "http://www.w3.org/2000/svg"
  }, rest), {}, {
    children: [/*#__PURE__*/_jsx("title", {
      children: TITLE
    }), /*#__PURE__*/_jsx("path", {
      d: "M6.593 16.075l-.011-.036L13.8 9.431V6.247H2.22V9.43h6.917l.011.03L2 16.075v3.184h11.916v-3.184H6.593zM21.025 5.943c-1.335 0-2.424.202-3.266.605a4.285 4.285 0 00-1.895 1.66 6.046 6.046 0 00-.795 2.403l3.514.494c.127-.75.381-1.28.763-1.592a2.328 2.328 0 011.51-.468c.713 0 1.23.191 1.552.572.318.382.48.91.48 1.606v.347H19.51c-1.72 0-2.956.381-3.707 1.144-.751.762-1.126 1.77-1.125 3.02 0 1.281.375 2.234 1.125 2.86.75.625 1.693.936 2.83.932 1.41 0 2.494-.485 3.252-1.454a5.404 5.404 0 00.94-2.004h.128l.484 3.184h3.184v-8.063c0-1.667-.439-2.958-1.317-3.873-.878-.915-2.305-1.373-4.279-1.373zm1.114 9.94c-.505.421-1.167.63-1.99.63-.68 0-1.151-.118-1.415-.356a1.165 1.165 0 01-.399-.905 1.19 1.19 0 01.33-.88 1.227 1.227 0 01.906-.33h3.323v.22a2.028 2.028 0 01-.755 1.62zM45.876 6.247h-3.762V19.26h3.762V6.247zM68.085 6.247c-1.063 0-1.9.375-2.513 1.125-.44.538-.774 1.335-1.002 2.389h-.111l-.492-3.514h-3.213v13.012h3.762v-6.673c0-.841.197-1.486.591-1.935.394-.449 1.121-.673 2.181-.673h1.428V6.247h-.63zM57.021 6.671c-.878-.522-1.986-.783-3.323-.781-2.105 0-3.752.599-4.942 1.798-1.19 1.198-1.784 2.85-1.784 4.957a7.9 7.9 0 00.81 3.678 5.84 5.84 0 002.307 2.43c.996.577 2.182.865 3.556.866 1.188 0 2.181-.183 2.978-.549a4.79 4.79 0 001.895-1.497c.47-.64.82-1.361 1.03-2.127l-3.241-.908c-.137.498-.4.953-.763 1.32-.366.366-.98.549-1.84.549-1.023 0-1.786-.293-2.288-.88-.364-.422-.593-1.027-.694-1.81h8.875c.037-.367.056-.674.056-.921v-.81a7.226 7.226 0 00-.658-3.158 4.943 4.943 0 00-1.974-2.157zm-3.431 2.32c1.525 0 2.39.751 2.594 2.252H50.79a3.1 3.1 0 01.604-1.374c.495-.586 1.227-.879 2.197-.877zM44.036 1.001a2.113 2.113 0 00-1.538.591 2.04 2.04 0 00-.604 1.526 2.068 2.068 0 002.142 2.14 2.035 2.035 0 001.526-.604 2.096 2.096 0 00.59-1.536 2.02 2.02 0 00-2.114-2.115l-.002-.002zM36.265 5.89c-1.281 0-2.31.402-3.089 1.207-.576.596-.998 1.485-1.268 2.669h-.12l-.492-3.514h-3.212V23h3.761v-6.898h.138c.114.46.275.907.48 1.334.318.697.84 1.28 1.497 1.674.68.372 1.448.557 2.223.536 1.575 0 2.774-.613 3.598-1.84.823-1.226 1.235-2.938 1.235-5.134 0-2.122-.398-3.783-1.195-4.982-.797-1.2-1.982-1.8-3.556-1.8zm.381 9.43c-.438.635-1.125.953-2.059.953a2.427 2.427 0 01-2.017-.92c-.487-.612-.73-1.45-.728-2.512v-.248c0-1.079.242-1.905.728-2.478.485-.574 1.158-.857 2.017-.85.951 0 1.642.301 2.073.905.43.604.646 1.446.646 2.526.003 1.118-.216 1.992-.656 2.624h-.004z"
    })]
  }));
});
export default Icon;