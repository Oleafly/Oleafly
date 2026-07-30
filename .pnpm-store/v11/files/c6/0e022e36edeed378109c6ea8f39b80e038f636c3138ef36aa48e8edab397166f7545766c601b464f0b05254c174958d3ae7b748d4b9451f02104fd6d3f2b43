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
    viewBox: "0 0 95 24",
    xmlns: "http://www.w3.org/2000/svg"
  }, rest), {}, {
    children: [/*#__PURE__*/_jsx("title", {
      children: TITLE
    }), /*#__PURE__*/_jsx("path", {
      d: "M15.322 10.493L19.928 0H16.1l-4.605 10.493h3.826zm-2.451 11.195v-3.68c0-2.782-.35-3.588-1.401-5.903L5.918 0H2l7.096 15.486v6.202h3.775zM54.68 22c1.737 0 3.177-.806 4.163-2.34l.195 2.028h3.424V0h-3.71v7.84c-.934-1.404-2.296-2.158-3.917-2.158-3.58 0-6.071 3.03-6.071 8.27 0 5.175 2.426 8.048 5.915 8.048zm22.752-1.365v-3.03c-1.154.78-3.074 1.47-4.89 1.47-2.698 0-3.736-1.288-3.892-3.901h8.938v-1.977c0-5.46-2.4-7.515-6.097-7.515-4.514 0-6.668 3.459-6.668 8.204 0 5.462 2.686 8.114 7.407 8.114 2.374 0 4.113-.624 5.202-1.365zM37.557 10.428c.687-.845 1.777-1.56 3.113-1.56 1.31 0 1.894.559 1.894 1.742v11.078h3.71V10.233c0-3.12-1.245-4.486-4.268-4.486-2.205 0-3.515.806-4.268 1.56h-.181l-.091-1.313h-3.62v15.694h3.71v-11.26zm-6.733.559c0-3.81-1.92-5.24-5.85-5.24-2.452 0-4.385.78-5.513 1.43v3.095c.998-.754 3.178-1.56 5.085-1.56 1.764 0 2.581.624 2.581 2.301v.884h-.597c-5.668 0-8.185 1.873-8.185 5.045 0 3.186 1.933 4.967 4.8 4.967 2.179 0 3.113-.715 3.826-1.47h.156c.026.404.156.937.273 1.249h3.619a37.98 37.98 0 01-.195-3.836v-6.865zm58.012 10.7H93l-5.098-8.074 4.41-7.619h-3.697L85.93 10.74l-2.984-4.746H78.77l4.735 7.515-4.916 8.179h3.762l3.152-5.305 3.334 5.305zM55.77 8.622c1.984 0 2.983 1.586 2.983 5.2 0 3.654-1.05 5.254-3.139 5.254-2.024 0-3.022-1.56-3.022-5.123 0-3.72 1.063-5.331 3.178-5.331zm15.657 0c1.842 0 2.4 1.52 2.4 3.484v.312h-5.176c.104-2.496.999-3.796 2.776-3.796zm-44.3 9.322c-.467.69-1.336 1.248-2.646 1.248-1.557 0-2.335-.87-2.335-2.21 0-1.781 1.271-2.431 4.45-2.431h.531v3.393z"
    })]
  }));
});
export default Icon;