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
    viewBox: "0 0 44 24",
    xmlns: "http://www.w3.org/2000/svg"
  }, rest), {}, {
    children: [/*#__PURE__*/_jsx("title", {
      children: TITLE
    }), /*#__PURE__*/_jsx("path", {
      d: "M2 18.658V2.763h4.956c1.509 0 2.71.336 3.59 1.01.881.672 1.322 1.547 1.322 2.624 0 .898-.253 1.683-.75 2.356a4.048 4.048 0 01-2.08 1.413v.045c1.079.124 1.927.527 2.565 1.223.65.673.97 1.57.97 2.658 0 1.358-.529 2.468-1.575 3.298-1.047.83-2.379 1.268-3.987 1.268H2zM4.588 4.883v4.52h1.674c.903 0 1.608-.224 2.115-.639.517-.449.77-1.054.77-1.84 0-1.368-.891-2.041-2.676-2.041H4.588zm0 6.64v5.026h2.203c.969 0 1.718-.224 2.235-.673.529-.46.793-1.088.793-1.885 0-1.648-1.112-2.467-3.359-2.467H4.588zm11.146-6.595c-.408 0-.771-.146-1.058-.415-.297-.27-.44-.617-.44-1.044 0-.426.143-.774.44-1.054.298-.28.65-.415 1.068-.415.419 0 .782.135 1.08.415.297.28.44.64.44 1.054 0 .404-.143.74-.44 1.032-.298.28-.661.427-1.09.427zm1.255 13.73h-2.522V7.306H17l-.011 11.352zm12.5 0h-2.522v-6.394c0-2.131-.738-3.186-2.203-3.186-.77 0-1.41.303-1.916.898a3.292 3.292 0 00-.749 2.21v6.472h-2.533V7.306H22.1V9.19h.044a4.007 4.007 0 011.505-1.602 3.909 3.909 0 012.107-.551c1.212 0 2.137.403 2.776 1.211.639.797.958 1.952.958 3.478v6.932zm12.5-.909c0 4.162-2.048 6.249-6.167 6.249a9.049 9.049 0 01-3.8-.74V20.9c1.211.718 2.379 1.066 3.47 1.066 2.643 0 3.975-1.324 3.975-3.982V16.75h-.044a4.125 4.125 0 01-1.579 1.632 4.026 4.026 0 01-2.188.533 4.034 4.034 0 01-1.811-.365 4.107 4.107 0 01-1.47-1.138 6.238 6.238 0 01-1.245-4.072c0-1.93.44-3.455 1.344-4.6.903-1.143 2.114-1.704 3.678-1.704 1.465 0 2.555.617 3.27 1.84h.045V7.305H42l-.01 10.443zm-2.5-4.285v-1.48c0-.797-.264-1.481-.782-2.042a2.534 2.534 0 00-.878-.642 2.491 2.491 0 00-1.06-.21c-.958 0-1.707.37-2.247 1.088a4.937 4.937 0 00-.815 3.017c0 1.122.265 2.008.77 2.681.53.673 1.212.998 2.071.998.882 0 1.587-.325 2.126-.953.55-.65.815-1.458.815-2.468v.011z"
    })]
  }));
});
export default Icon;