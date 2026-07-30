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
      d: "M20.713 6.655c-.414-1.426-1.748-2.472-3.357-2.472a3.62 3.62 0 00-1.7.423C14.62 3.046 12.804 2 10.735 2 7.77 2 5.31 4.16 4.943 6.944 2.138 7.39 0 9.728 0 12.58c0 3.14 2.62 5.68 5.862 5.68 1.61 0 3.08-.646 4.138-1.671.276-.267.529-.557.736-.89a5.02 5.02 0 01-.713.845 8.998 8.998 0 00-1.77 5.39V22a16.682 16.682 0 018.666-2.717h.046c3.035 0 5.633-1.871 6.621-4.499A6.599 6.599 0 0024 12.445c0-2.427-1.31-4.565-3.287-5.79zM6.966 12.869a.836.836 0 01-.851.824.81.81 0 01-.805-.824v-2.183a.81.81 0 01.805-.824c.46 0 .85.379.85.824v2.183zm3.011 1.069a.86.86 0 01-.874.846.86.86 0 01-.873-.846v-4.9a.86.86 0 01.873-.846.86.86 0 01.874.846v4.9zm3.104-1.047c0 .445-.414.824-.874.824s-.85-.379-.85-.824v-2.227c0-.446.367-.824.85-.824.46 0 .873.378.873.824v2.227zm3.149 1.069a.86.86 0 01-.874.846.86.86 0 01-.873-.846v-4.9a.86.86 0 01.873-.846.86.86 0 01.874.846v4.9zm3.08-1.091a.836.836 0 01-.85.824.81.81 0 01-.805-.824v-2.183a.81.81 0 01.805-.824c.46 0 .85.379.85.824v2.183z",
      fill: "#2A80E2"
    })]
  }));
});
export default Icon;