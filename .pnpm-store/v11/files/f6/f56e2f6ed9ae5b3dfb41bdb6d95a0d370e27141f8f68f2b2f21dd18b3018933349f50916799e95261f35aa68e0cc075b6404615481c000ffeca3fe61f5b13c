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
    viewBox: "0 0 130 24",
    xmlns: "http://www.w3.org/2000/svg"
  }, rest), {}, {
    children: [/*#__PURE__*/_jsx("title", {
      children: TITLE
    }), /*#__PURE__*/_jsx("path", {
      d: "M2 10.955C2 5.679 5.398 2 10.106 2s8.106 3.679 8.106 8.955-3.398 8.955-8.106 8.955S2 16.23 2 10.955zm13.105 0c0-3.776-2.062-6.22-4.999-6.22s-5 2.444-5 6.22c0 3.775 2.063 6.22 5 6.22s5-2.445 5-6.22zM26.84 19.91c-1.651 0-2.865-.654-3.666-1.598V24h-2.912V6.937h2.912v1.356c.801-.944 2.015-1.598 3.665-1.598 3.568 0 5.607 3.001 5.607 6.608 0 3.606-2.04 6.607-5.607 6.607zm-3.738-6.97v.75c0 2.347 1.359 3.679 3.155 3.679 2.111 0 3.252-1.646 3.252-4.066s-1.14-4.066-3.252-4.066c-1.796 0-3.155 1.306-3.155 3.703zM39.841 19.91c-3.64 0-6.189-2.687-6.189-6.607 0-3.728 2.524-6.608 6.068-6.608 3.689 0 5.655 2.784 5.655 6.269v.968h-8.932c.219 2.178 1.53 3.51 3.398 3.51 1.432 0 2.573-.727 2.961-2.034l2.5.944c-.898 2.227-2.913 3.558-5.46 3.558zm-.145-10.77c-1.505 0-2.67.895-3.107 2.614h5.849c-.024-1.404-.898-2.614-2.742-2.614zM47.317 19.644V6.937h2.912v1.356c.729-.847 1.869-1.598 3.52-1.598 2.67 0 4.271 1.84 4.271 4.575v8.374h-2.913v-7.527c0-1.574-.63-2.711-2.232-2.711-1.31 0-2.646.968-2.646 2.783v7.455h-2.912zM72.327 2.267h3.106v17.377h-3.106v-7.6h-8.35v7.6h-3.106V2.267h3.106v7.067h8.35V2.267zM81.751 19.861c-2.427 0-4.296-1.476-4.296-3.751 0-2.42 1.82-3.485 4.272-3.993l3.519-.726v-.218c0-1.21-.631-1.96-2.185-1.96-1.383 0-2.11.629-2.451 1.863l-2.742-.63c.631-2.105 2.5-3.75 5.315-3.75 3.058 0 4.903 1.451 4.903 4.38v5.47c0 .726.315.944 1.115.847v2.25c-2.11.243-3.227-.169-3.664-1.21-.801.896-2.136 1.428-3.786 1.428zm3.495-4.695v-1.549l-2.742.581c-1.238.266-2.16.653-2.16 1.791 0 .992.728 1.549 1.844 1.549 1.553 0 3.058-.823 3.058-2.372zM91.028 19.644V6.937h2.913v1.356c.727-.847 1.868-1.598 3.519-1.598 2.669 0 4.271 1.84 4.271 4.575v8.374h-2.913v-7.527c0-1.574-.63-2.711-2.232-2.711-1.31 0-2.645.968-2.645 2.783v7.455h-2.913zM109.266 19.91c-3.567 0-5.606-3-5.606-6.607 0-3.606 2.039-6.607 5.606-6.607 1.65 0 2.864.653 3.665 1.597V2.267h2.913v17.377h-2.913v-1.331c-.801.944-2.015 1.597-3.665 1.597zm3.737-6.97c0-2.396-1.358-3.703-3.154-3.703-2.112 0-3.253 1.646-3.253 4.066s1.141 4.066 3.253 4.066c1.796 0 3.154-1.331 3.154-3.679v-.75zM117.317 17.223l2.184-1.742c.752 1.234 2.209 2.057 3.689 2.057 1.238 0 2.379-.436 2.379-1.573 0-1.09-1.068-1.21-3.083-1.622-2.014-.411-4.32-.92-4.32-3.63 0-2.324 2.039-4.018 4.975-4.018 2.233 0 4.224.993 5.145 2.396l-1.965 1.767c-.728-1.137-1.942-1.79-3.349-1.79-1.189 0-1.966.532-1.966 1.379 0 .92.922 1.089 2.524 1.428 2.16.46 4.878.92 4.878 3.824 0 2.565-2.354 4.21-5.242 4.21-2.354 0-4.708-.943-5.849-2.686z"
    })]
  }));
});
export default Icon;