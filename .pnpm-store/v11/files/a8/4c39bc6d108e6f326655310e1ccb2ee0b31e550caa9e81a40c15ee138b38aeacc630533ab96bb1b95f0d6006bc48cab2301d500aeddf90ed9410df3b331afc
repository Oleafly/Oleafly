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
      d: "M15.855 17.122c-2.092.924-4.358.545-5.23.24 0 .21-.01.857-.048 1.78-.038.924-.332 1.507-.475 1.684.016.577.029 1.837-.047 2.26a1.93 1.93 0 01-.476.914H8.295c.114-.577.555-.946.761-1.058.114-1.193-.11-2.229-.238-2.597-.126.449-.437 1.49-.665 2.068a6.418 6.418 0 01-.713 1.299h-.951c-.048-.578.27-.77.475-.77.095-.177.323-.731.476-1.54.152-.807-.064-2.324-.19-2.981v-2.068c-1.522-.818-2.092-1.636-2.473-2.55-.304-.73-.222-1.843-.142-2.308-.096-.176-.373-.625-.476-1.25-.142-.866-.063-1.491 0-1.828-.095-.096-.285-.587-.285-1.78 0-1.192.349-1.811.523-1.972v-.529c-.666-.048-1.331-.336-1.712-.721-.38-.385-.095-.962.143-1.154.238-.193.475-.049.808-.145.333-.096.618-.192.76-.48C4.512 1.403 4.287.448 4.16 0c.57.077.935.577 1.046.818V0c.713.337 1.997 1.154 2.425 2.934.342 1.424.586 4.409.665 5.723 1.823.016 4.137-.26 6.229.193 1.901.412 2.757 1.25 3.755 1.25.999 0 1.57-.577 2.282-.096.714.481 1.094 1.828.999 2.838-.076.808-.697 1.074-.998 1.106-.38 1.27 0 2.485.237 2.934v1.827c.111.16.333.655.333 1.347 0 .693-.222 1.154-.333 1.299.19 1.077-.08 2.18-.238 2.597h-1.283c.152-.385.412-.481.523-.481.228-1.193.063-2.293-.048-2.693-.722-.424-1.188-1.17-1.331-1.491.016.272-.029 1.029-.333 1.875-.304.847-.76 1.347-.95 1.491v1.01h-1.284c0-.615.348-.737.523-.721.222-.4.76-1.01.76-2.212 0-1.015-.713-1.492-1.236-2.405-.248-.434-.127-.978-.047-1.203z"
    })]
  }));
});
export default Icon;