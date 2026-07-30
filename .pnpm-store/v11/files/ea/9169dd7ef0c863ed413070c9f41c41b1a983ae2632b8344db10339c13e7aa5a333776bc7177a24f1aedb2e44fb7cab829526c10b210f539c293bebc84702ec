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
      d: "M11.484.028c2.054-.088 2.932.167 3.08.895.1.501-.268.957-2.883 3.57L9.106 7.064l-.732.01c-.555.008-.824.058-1.108.21-1.114.593-1.62 1.858-1.216 3.041.328.964 1.3 1.636 2.34 1.62.215-.005.476-.039.678-.087l-.027.01.093-.03c.924-.27 1.66-1.312 1.665-2.358.002-.344.063-.625.176-.808.095-.156 1.45-1.556 3.012-3.113 3.134-3.122 3.25-3.21 4.287-3.213.823-.003 1.257.225 2.194 1.16a11.968 11.968 0 012.73 4.162l.001-.002.115.281c.206.504.491 1.709.602 2.538.134 1 .06 3-.143 3.938a12.129 12.129 0 01-3.278 6.052c-1.635 1.646-3.678 2.763-6.027 3.294-.712.162-3.534.265-4.062.15-.878-.192-1.255-.82-.897-1.494.074-.14 1.31-1.425 2.746-2.858l2.611-2.603.793-.026c.53-.016.895-.078 1.097-.186.423-.225.895-.718 1.104-1.152.135-.28.218-.81.22-1.229a2.443 2.443 0 00-.626-1.455c-1.163-1.287-3.25-1.005-4.008.542-.2.41-.249.64-.244 1.151l.006.639-.067.063-2.937 2.94c-3.255 3.258-3.448 3.407-4.434 3.403-.361-.002-.715-.07-.976-.188-.504-.23-1.726-1.402-2.423-2.326-.895-1.188-1.64-2.787-2.067-4.422l-.081-.328-.055-.255a6.168 6.168 0 01-.094-.866c.023.318.055.61.097.859-.21-1.249-.173-3.632.094-4.706a4.787 4.787 0 00-.052.235c.103-.564.27-1.105.535-1.829 1.04-2.842 3.136-5.177 5.88-6.553C8.253.461 9.62.11 11.484.028z"
    })]
  }));
});
export default Icon;