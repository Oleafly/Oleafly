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
      d: "M6.082 8.241C4.83 7.441 4 6.057 4 4.483 4 2.007 6.05 0 8.578 0h7.844C18.95 0 21 2.007 21 4.483c0 1.574-.829 2.959-2.082 3.758C20.17 9.041 21 10.426 21 12c0 2.476-2.05 4.483-4.578 4.483h-.084A4.615 4.615 0 0113.24 15.3v4.176C13.24 21.98 11.145 24 8.599 24 6.076 24 4 21.998 4 19.517c0-1.574.829-2.959 2.082-3.758C4.829 14.959 4 13.574 4 12c0-1.574.829-2.959 2.082-3.759zM13.24 12c0 1.676 1.387 3.034 3.098 3.034h.084c1.711 0 3.099-1.358 3.099-3.034 0-1.676-1.388-3.034-3.1-3.034h-.083c-1.71 0-3.098 1.358-3.098 3.034zm-1.48-3.034H8.578C6.867 8.966 5.48 10.324 5.48 12c0 1.672 1.382 3.029 3.089 3.034H11.76V8.966zm-3.182 7.517h-.01c-1.707.005-3.089 1.362-3.089 3.034 0 1.67 1.403 3.034 3.12 3.034 1.74 0 3.161-1.381 3.161-3.075v-2.993H8.578zm3.182-8.966H8.578c-1.711 0-3.099-1.358-3.099-3.034 0-1.676 1.388-3.034 3.1-3.034h3.181v6.068zm4.662 0H13.24V1.45h3.182c1.711 0 3.099 1.358 3.099 3.034 0 1.676-1.388 3.034-3.1 3.034z"
    })]
  }));
});
export default Icon;