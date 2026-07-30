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
      d: "M8.858 17.115c.156-.414.065-.273.495.098 2.073 1.792 10.334-1.855 9.035-3.987-1.605-2.223-7.924-.72-11.499-.048.57-.259 2.835-.998 3.686-1.213 1.169-.296 1.65-.392 2.738-.651-2.45.25-6.216 1.493-9.687 2.797 1.692-1.346 5.077-2.538 5.854-2.901-1.606.363-4.596 1.708-6.845 2.845C1.358 14.7.932 14.94 0 15.458c.696-.595 1.53-1.383 2.951-2.216 1.714-1.003 1.815-1.048 2.333-1.359-1.244.518-2.383 1.037-3.16 1.296.773-.534 2.227-1.347 2.797-1.606-.173.015-.518.155-.725.207 1.036-.57 1.799-.83 2.234-.97 7.42-2.442 15.999-2.182 17.32.528 1.322 2.71-2.766 6.486-8.347 7.709-.966.212-1.821.328-2.626.358-.836.031-1.448-.005-2.037-.12-1.563-.305-2.237-1.232-1.882-2.17z"
    }), /*#__PURE__*/_jsx("path", {
      d: "M11.5 6.185c.673.104.984.156 1.347.156-.57-.363-.702-.405-2.02-1.14 1.294-.103 1.906-.024 3.366-.052-.621-.362-.932-.362-1.605-.673a33.982 33.982 0 012.797-.104 1.3 1.3 0 00-.415-.362c1.45-.052 3.51.096 4.685.62 2.292 1.027 1.995 2.619-.57 3.063-.471.081-1.315.148-1.874.15a12.536 12.536 0 01-2.138-.212c-1.871-.358-3.314-.98-3.573-1.446z"
    })]
  }));
});
export default Icon;