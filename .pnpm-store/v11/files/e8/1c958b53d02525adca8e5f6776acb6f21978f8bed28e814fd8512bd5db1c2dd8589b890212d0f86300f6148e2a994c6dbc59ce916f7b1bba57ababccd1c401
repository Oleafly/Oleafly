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
    viewBox: "0 0 157 24",
    xmlns: "http://www.w3.org/2000/svg"
  }, rest), {}, {
    children: [/*#__PURE__*/_jsx("title", {
      children: TITLE
    }), /*#__PURE__*/_jsx("path", {
      d: "M151.37 21.525V.475h3.203v21.05h-3.203zM132.463 21.525V.475h7.857c2.392 0 4.26.582 5.604 1.748 1.364 1.147 2.046 2.748 2.046 4.804 0 2.055-.682 3.676-2.046 4.862-1.344 1.166-3.212 1.75-5.604 1.75h-4.655v7.886h-3.202zm3.202-10.792h4.566c2.945 0 4.418-1.236 4.418-3.706 0-2.412-1.473-3.618-4.418-3.618h-4.566v7.324zM110.73 21.525l7.59-21.05h4.062l7.591 21.05h-3.41l-1.927-5.485h-8.599l-1.897 5.485h-3.41zm6.315-8.39h6.612l-3.32-9.607-3.292 9.606zM103.956 21.525V6.523h-4.447v-2.58h1.809c1.205 0 2.055-.247 2.549-.741.514-.494.771-1.404.771-2.728h2.521v21.051h-3.203zM83.059 21.525V.475h3.143v7.56c.415-.91 1.028-1.572 1.838-1.987.83-.435 1.76-.652 2.787-.652 1.72 0 3.034.563 3.943 1.69.91 1.107 1.364 2.54 1.364 4.3v10.14h-3.143v-9.31c0-2.788-.998-4.181-2.994-4.181-1.166 0-2.096.365-2.787 1.097-.672.711-1.008 1.759-1.008 3.143v9.25h-3.143zM73.135 21.88c-1.503 0-2.817-.335-3.944-1.007-1.126-.692-1.996-1.65-2.609-2.876-.613-1.245-.919-2.698-.919-4.359 0-1.66.306-3.103.92-4.329.612-1.245 1.482-2.203 2.608-2.876 1.127-.691 2.441-1.037 3.944-1.037 1.917 0 3.508.504 4.773 1.512 1.265.988 2.026 2.392 2.283 4.21l-3.29.178c-.159-1.028-.574-1.809-1.246-2.342-.672-.554-1.512-.83-2.52-.83-1.325 0-2.362.494-3.114 1.482-.73.969-1.097 2.313-1.097 4.032 0 1.74.366 3.094 1.097 4.062.752.969 1.79 1.453 3.114 1.453 1.008 0 1.848-.277 2.52-.83.672-.573 1.087-1.433 1.245-2.58l3.291.178c-.257 1.819-1.018 3.272-2.283 4.359-1.245 1.067-2.836 1.6-4.773 1.6zM56.16 21.525V5.752h2.876l.089 2.994c.296-1.028.751-1.779 1.364-2.253.632-.494 1.433-.741 2.401-.741h1.513v2.816H62.89c-1.205 0-2.105.297-2.698.89s-.89 1.512-.89 2.757v9.31H56.16zM43.9 21.88c-1.64 0-2.955-.375-3.944-1.126-.968-.75-1.453-1.808-1.453-3.172 0-1.344.406-2.402 1.216-3.173.83-.77 2.105-1.324 3.825-1.66l5.426-1.038c0-2.431-1.137-3.647-3.41-3.647-1.008 0-1.799.228-2.372.682-.573.455-.968 1.107-1.186 1.957l-3.232-.207c.297-1.582 1.028-2.827 2.194-3.736 1.186-.91 2.718-1.364 4.596-1.364 2.135 0 3.756.573 4.863 1.72 1.126 1.126 1.69 2.717 1.69 4.773v6.137c0 .376.059.643.178.801.138.138.355.208.652.208h.563v2.49c-.276.06-.662.09-1.156.09-.89 0-1.601-.189-2.135-.564-.534-.376-.86-1.028-.978-1.957-.396.83-1.078 1.502-2.046 2.016-.969.514-2.066.77-3.291.77zm.504-2.49c1.423 0 2.54-.405 3.35-1.215s1.216-1.838 1.216-3.084v-1.008l-4.626.89c-.948.177-1.62.464-2.016.86-.375.375-.563.86-.563 1.452 0 .672.227 1.196.682 1.572.474.355 1.127.533 1.957.533zM28.863 21.88c-1.542 0-2.876-.335-4.003-1.007-1.107-.692-1.966-1.65-2.58-2.876-.592-1.245-.889-2.698-.889-4.359 0-1.66.297-3.103.89-4.329.613-1.245 1.472-2.203 2.58-2.876 1.106-.691 2.41-1.037 3.913-1.037 1.423 0 2.678.336 3.766 1.008 1.087.652 1.927 1.6 2.52 2.846.613 1.245.919 2.748.919 4.507v.8H24.653c.079 1.542.484 2.699 1.215 3.47.752.77 1.76 1.156 3.025 1.156.929 0 1.69-.208 2.283-.623.613-.435 1.047-1.028 1.304-1.779l3.262.208c-.415 1.482-1.236 2.668-2.461 3.558-1.206.89-2.678 1.334-4.418 1.334zm-4.21-9.694h8.005c-.099-1.404-.504-2.442-1.215-3.114-.712-.672-1.602-1.008-2.669-1.008-1.127 0-2.056.356-2.787 1.068-.711.691-1.156 1.71-1.334 3.053zM10.54 22c-1.681 0-3.144-.306-4.39-.92-1.225-.612-2.193-1.462-2.905-2.549C2.534 17.444 2.12 16.179 2 14.736l3.291-.208c.198 1.463.731 2.59 1.601 3.38.89.791 2.125 1.186 3.706 1.186 1.364 0 2.422-.257 3.173-.77.751-.515 1.127-1.266 1.127-2.254 0-.593-.149-1.117-.445-1.571-.277-.475-.82-.9-1.63-1.275-.792-.396-1.958-.781-3.5-1.157-1.68-.395-3.024-.84-4.032-1.334-1.008-.514-1.74-1.136-2.194-1.868-.435-.75-.652-1.67-.652-2.757 0-1.206.286-2.263.86-3.173.593-.929 1.433-1.65 2.52-2.164C6.912.257 8.217 0 9.739 0c1.6 0 2.974.296 4.12.89 1.147.592 2.047 1.403 2.699 2.43.652 1.029 1.058 2.205 1.216 3.53l-3.292.177c-.158-1.206-.642-2.194-1.452-2.965-.791-.77-1.908-1.156-3.35-1.156-1.226 0-2.195.286-2.906.86-.692.553-1.038 1.294-1.038 2.223 0 .613.138 1.117.415 1.512.296.396.81.751 1.542 1.068.75.296 1.808.603 3.172.919 1.819.415 3.262.929 4.33 1.542 1.067.593 1.828 1.294 2.282 2.105.474.81.712 1.73.712 2.757 0 1.245-.326 2.333-.979 3.262-.632.909-1.522 1.61-2.668 2.105-1.147.494-2.48.741-4.003.741z"
    })]
  }));
});
export default Icon;