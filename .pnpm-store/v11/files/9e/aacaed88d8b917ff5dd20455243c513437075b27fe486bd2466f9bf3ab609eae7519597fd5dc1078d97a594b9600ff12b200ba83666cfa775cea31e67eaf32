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
    viewBox: "0 0 96 24",
    xmlns: "http://www.w3.org/2000/svg"
  }, rest), {}, {
    children: [/*#__PURE__*/_jsx("title", {
      children: TITLE
    }), /*#__PURE__*/_jsx("path", {
      d: "M77.948 22l6.192-10.114L77.89 2h3.468l4.73 7.486L90.503 2h3.411l-6.22 10.029L94 22h-3.468l-4.759-7.543L81.36 22h-3.41zM54.29 22V2h6.908c1.586 0 2.885.267 3.898.8 1.032.533 1.796 1.257 2.293 2.171.497.896.746 1.896.746 3a5.972 5.972 0 01-1.004 3.372c-.65 1.01-1.672 1.733-3.067 2.171L68.334 22H64.81l-3.899-8.057h-3.583V22H54.29zm3.038-10.343h3.698c1.376 0 2.379-.333 3.01-1 .65-.667.974-1.533.974-2.6 0-1.067-.315-1.914-.946-2.543-.63-.647-1.653-.971-3.067-.971h-3.669v7.114zM29.377 22V2h7.566c2.083 0 3.66.486 4.73 1.457 1.07.972 1.605 2.19 1.605 3.657 0 1.276-.344 2.296-1.032 3.057a5.21 5.21 0 01-2.494 1.515 4.826 4.826 0 012.036.914 4.796 4.796 0 011.433 1.714 4.9 4.9 0 01.516 2.229c0 1.028-.258 1.962-.774 2.8-.497.819-1.233 1.467-2.207 1.943-.975.476-2.17.714-3.583.714h-7.797zm3.037-11.429h4.157c1.165 0 2.054-.266 2.665-.8.612-.552.918-1.304.918-2.257 0-.933-.306-1.676-.918-2.228-.592-.553-1.5-.829-2.723-.829h-4.099v6.114zm0 8.943h4.357c1.223 0 2.17-.285 2.838-.857.688-.571 1.032-1.371 1.032-2.4 0-1.028-.354-1.838-1.06-2.428-.708-.61-1.663-.915-2.867-.915h-4.3v6.6zM2 22V2h6.507c2.35 0 4.28.41 5.79 1.229 1.528.819 2.656 1.98 3.382 3.485.745 1.486 1.118 3.257 1.118 5.315 0 2.038-.373 3.81-1.118 5.314-.726 1.486-1.854 2.638-3.382 3.457-1.51.8-3.44 1.2-5.79 1.2H2zm3.038-2.571h3.354c1.815 0 3.249-.296 4.3-.886 1.07-.59 1.834-1.438 2.293-2.543.477-1.105.716-2.429.716-3.971 0-1.543-.239-2.877-.716-4a5.03 5.03 0 00-2.293-2.572c-1.051-.61-2.485-.914-4.3-.914H5.038v14.886z"
    })]
  }));
});
export default Icon;