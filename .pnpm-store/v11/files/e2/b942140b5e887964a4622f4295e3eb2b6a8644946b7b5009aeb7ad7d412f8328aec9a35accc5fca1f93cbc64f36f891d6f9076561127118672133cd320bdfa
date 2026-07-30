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
    viewBox: "0 0 131 24",
    xmlns: "http://www.w3.org/2000/svg"
  }, rest), {}, {
    children: [/*#__PURE__*/_jsx("title", {
      children: TITLE
    }), /*#__PURE__*/_jsx("path", {
      d: "M0 23.799V.465h14.93v3.4H3.84v6.767h9.152v3.3H3.841v9.867H0zM19.177 4.333c-1.236 0-2.204-.9-2.204-2.166C16.973.9 17.94 0 19.177 0c1.236 0 2.204.9 2.204 2.167 0 1.266-.968 2.166-2.204 2.166zM17.34 23.801V6.732h3.607V23.8H17.34zM32.967 6.734h.802v3.367h-1.604c-3.206 0-4.241 2.5-4.241 5.134V23.8h-3.608V6.734h3.207l.4 2.567c.869-1.433 2.238-2.567 5.044-2.567zM43.128 23.998c-5.378 0-8.751-3.466-8.751-8.7 0-5.267 3.373-8.767 8.417-8.767 4.943 0 8.25 3.134 8.35 8.134 0 .433-.034.9-.1 1.366H38.15v.234c.1 2.9 1.937 4.8 4.776 4.8 2.205 0 3.808-1.1 4.309-3h3.607c-.601 3.366-3.474 5.933-7.715 5.933zm-4.843-10.6h9.118c-.3-2.533-2.071-3.967-4.576-3.967-2.305 0-4.275 1.534-4.542 3.967zM61.74 23.998c-5.178 0-8.484-3.367-8.484-8.7 0-5.267 3.407-8.767 8.584-8.767 4.408 0 7.147 2.434 7.849 6.3h-3.775c-.467-2-1.904-3.233-4.141-3.233-2.906 0-4.81 2.333-4.81 5.7 0 3.333 1.904 5.633 4.81 5.633 2.204 0 3.674-1.266 4.108-3.233h3.808c-.67 3.867-3.574 6.3-7.95 6.3zM80.933 6.734h.802v3.367h-1.603c-3.207 0-4.242 2.5-4.242 5.134V23.8h-3.607V6.734h3.207l.4 2.567c.868-1.433 2.238-2.567 5.043-2.567zM90.65 6.531c4.543 0 7.148 2.167 7.148 6.2v11.067h-3.14l-.3-2.433c-1.17 1.533-2.806 2.633-5.51 2.633-3.742 0-6.246-1.833-6.246-5 0-3.5 2.538-5.467 7.347-5.467h4.276v-1.033c0-1.9-1.37-3.067-3.741-3.067-2.138 0-3.574 1-3.841 2.5h-3.54c.367-3.333 3.24-5.4 7.548-5.4zm-1.202 14.667c3.006 0 4.743-1.767 4.777-4.4v-.6h-4.477c-2.237 0-3.472.833-3.472 2.567 0 1.433 1.201 2.433 3.172 2.433zM104.853 23.801L99.275 6.734h3.808l3.908 13.067 3.908-13.067h3.305l3.741 13.067 4.042-13.067h3.674l-5.678 17.067h-3.875l-3.606-11.6-3.741 11.6h-3.908zM127.393 23.799V.465H131v23.334h-3.607z"
    })]
  }));
});
export default Icon;