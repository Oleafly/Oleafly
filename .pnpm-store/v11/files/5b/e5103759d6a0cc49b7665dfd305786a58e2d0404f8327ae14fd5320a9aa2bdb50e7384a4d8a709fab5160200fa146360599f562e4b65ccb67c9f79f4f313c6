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
      d: "M23.034 17.06c.017-.034.034-.069.034-.103.135-.347.27-.763.338-1.11.88-3.12.948-7.14-2.232-11.438-.08-.082-.135-.163-.182-.23-.033-.048-.06-.088-.089-.117.812-.624 1.827-.832 2.571-.832.406 0 .609-.485.338-.763C21.174-.444 18.265-.375 16.235.734c-3.314-1.248-6.9-.832-9.065.694-3.72 2.565-3.72 5.476-1.826 8.18a7.814 7.814 0 00-.744 2.08c-.136.693.676 1.178 1.15.693.947-.901 2.165-2.01 2.773-2.426 1.489-1.11 2.436-1.526 3.789-1.733h.067c.474-.07.88-.139 1.353-.139a7.765 7.765 0 017.645 6.378l.02.168c.06.487.115.929.115 1.426v.347l-.203-.624c-.812-1.594-2.367-2.773-4.262-2.773 0 .486 0 1.04-.067 1.525-.271 2.635-1.827 4.715-3.924 5.893-.068 0-.068.07-.135.07-.203.069-.474.207-.677.277a1.152 1.152 0 01-.169.07c-.05.016-.101.034-.17.068a5.74 5.74 0 01-2.164.416h-.406c-.473 0-1.015 0-1.488-.139-1.083-.207-2.03-.693-2.842-1.317-.473-.346-.879-.762-1.285-1.247 1.76 2.773 4.668 4.783 8.118 5.268a8.603 8.603 0 002.3.07 18.14 18.14 0 001.894-.347 7.613 7.613 0 001.76-.624c.473-.208.879-.416 1.285-.693 0 0 .023-.024.056-.044a.16.16 0 01.08-.025c.134-.14.337-.208.473-.347.312-.256.566-.512.816-.767l-.005.005c.203-.209.339-.417.542-.625.336-.413.672-.896 1.009-1.378l.005-.008c.339-.624.677-1.248.947-1.941 0-.035.017-.07.034-.104zM2.977 14.53v3.05H0v-3.05h2.977z"
    })]
  }));
});
export default Icon;