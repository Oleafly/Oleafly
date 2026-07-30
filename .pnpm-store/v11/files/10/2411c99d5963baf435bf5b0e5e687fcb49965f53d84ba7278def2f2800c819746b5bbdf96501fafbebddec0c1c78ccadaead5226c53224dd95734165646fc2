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
    viewBox: "0 0 111 24",
    xmlns: "http://www.w3.org/2000/svg"
  }, rest), {}, {
    children: [/*#__PURE__*/_jsx("title", {
      children: TITLE
    }), /*#__PURE__*/_jsx("path", {
      d: "M2 2h2.314v17.355h8.926v2.15H2V2zm28.402 12.066c0 1.065-.137 2.075-.413 3.03-.257.956-.68 1.8-1.267 2.535-.57.716-1.323 1.295-2.26 1.735-.936.423-2.074.634-3.415.634-1.34 0-2.48-.211-3.416-.634-.937-.44-1.699-1.019-2.287-1.735a7.47 7.47 0 01-1.267-2.535 11.616 11.616 0 01-.386-3.03V2h2.315v11.736c0 .79.082 1.551.247 2.286.166.735.441 1.387.827 1.956.386.57.9 1.028 1.543 1.377.642.331 1.45.496 2.424.496.973 0 1.781-.165 2.424-.496a4.311 4.311 0 001.543-1.377 5.67 5.67 0 00.826-1.956c.166-.735.248-1.497.248-2.286V2h2.314v12.066zM35.171 2h3.443l6.612 15.29h.055L51.948 2h3.36v19.504h-2.313V5.14h-.056l-6.997 16.364h-1.405L37.54 5.14h-.055v16.364H35.17V2zm31.328 0h2.177l8.292 19.504h-2.7l-1.983-4.793h-9.752l-2.011 4.793h-2.618L66.5 2zm1.047 2.975h-.055l-4.05 9.587h7.962l-3.857-9.587zM93.563 2h2.177l8.292 19.504h-2.7l-1.983-4.793h-9.753l-2.01 4.793h-2.618L93.563 2zm1.047 2.975h-.055l-4.05 9.587h7.962L94.61 4.975zM106.624 2h2.314v19.504h-2.314V2z"
    })]
  }));
});
export default Icon;