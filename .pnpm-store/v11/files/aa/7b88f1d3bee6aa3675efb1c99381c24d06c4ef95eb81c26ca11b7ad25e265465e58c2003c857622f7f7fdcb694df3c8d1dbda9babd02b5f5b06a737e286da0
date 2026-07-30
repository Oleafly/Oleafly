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
    viewBox: "0 0 97 24",
    xmlns: "http://www.w3.org/2000/svg"
  }, rest), {}, {
    children: [/*#__PURE__*/_jsx("title", {
      children: TITLE
    }), /*#__PURE__*/_jsx("path", {
      d: "M2 4.375h3.051v3.266c.833-2.434 2.774-3.635 5.117-3.635 2.404 0 4.53 1.294 5.425 3.944.863-2.65 3.02-3.944 5.455-3.944 3.206 0 5.887 2.218 5.887 6.87V21.63h-3.082V11.123c0-2.65-1.202-4.437-3.76-4.437-2.774 0-4.069 2.065-4.069 4.9V21.63h-3.082V11.123c0-2.65-1.202-4.437-3.791-4.437-2.774 0-4.069 2.065-4.069 4.9V21.63H2V4.375zm27.737 12.972c0-2.341 1.51-4.098 4.253-4.96l5.795-1.88c-.154-2.65-1.418-3.697-3.914-3.697-1.449 0-3.021.338-5.271 1.201V5.053c1.942-.616 3.853-1.047 5.64-1.047 4.593 0 6.627 2.865 6.627 6.994v10.63h-3.02v-2.526C38.89 20.89 37.042 22 34.76 22c-3.144 0-5.024-2.034-5.024-4.653zm3.113-.246c0 1.386 1.11 2.434 2.805 2.434 2.096 0 4.13-1.571 4.13-3.913v-2.588l-4.592 1.479c-1.603.493-2.343 1.417-2.343 2.588zM50.406 22c-1.232 0-2.681-.216-4.407-.893v-2.928c1.664.74 3.175 1.079 4.407 1.079 1.973 0 2.836-.986 2.836-2.219 0-1.417-1.14-2.003-2.866-2.804-2.189-1.016-4.654-2.095-4.654-5.269 0-2.927 2.126-4.96 5.917-4.96 1.202 0 2.62.185 4.254.677V7.55c-1.572-.493-3.052-.801-4.254-.801-1.942 0-2.805.986-2.805 2.157 0 1.294 1.141 1.818 2.836 2.619 2.22 1.017 4.685 2.188 4.685 5.454 0 2.988-2.127 5.022-5.948 5.022zm15.563-.185c-3.452 0-4.931-1.633-4.931-4.93V7.148h-2.62V4.375h2.62V.894L64.12 0v4.375h4.5v2.773h-4.5v9.275c0 2.095.647 2.557 2.28 2.557.771 0 1.542-.092 2.22-.215v2.804c-.894.154-1.757.246-2.65.246zm5.442-17.44h3.05v4.037c.925-2.68 3.052-4.252 6.135-4.252v3.173c-.339-.03-.648-.061-.987-.061-3.113 0-5.116 1.94-5.116 5.854v8.504H71.41V4.375zm10.46 12.972c0-2.341 1.51-4.098 4.252-4.96l5.794-1.88c-.153-2.65-1.417-3.697-3.914-3.697-1.448 0-3.02.338-5.27 1.201V5.053c1.942-.616 3.853-1.047 5.64-1.047C92.967 4.006 95 6.87 95 11v10.63h-3.02v-2.526C91.024 20.89 89.175 22 86.894 22c-3.144 0-5.024-2.034-5.024-4.653zm3.112-.246c0 1.386 1.11 2.434 2.805 2.434 2.096 0 4.13-1.571 4.13-3.913v-2.588l-4.592 1.479c-1.603.493-2.343 1.417-2.343 2.588z"
    })]
  }));
});
export default Icon;