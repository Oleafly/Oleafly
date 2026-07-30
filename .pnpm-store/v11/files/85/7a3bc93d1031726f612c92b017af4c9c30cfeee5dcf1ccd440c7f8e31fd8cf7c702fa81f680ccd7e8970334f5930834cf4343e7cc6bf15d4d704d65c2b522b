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
    viewBox: "0 0 211 24",
    xmlns: "http://www.w3.org/2000/svg"
  }, rest), {}, {
    children: [/*#__PURE__*/_jsx("title", {
      children: TITLE
    }), /*#__PURE__*/_jsx("path", {
      d: "M2 19.166L14.613 8.652v-.42H2.307V4.823h18.44v2.452L8.134 17.865v.739l12.613-.35v3.408H2v-2.495zM46.34 14.262H28.965c.306 2.56 1.944 4.636 7.09 4.636 4.466 0 6.035-1.326 6.304-2.728h3.99c-.201 2.935-3.102 5.824-10.294 5.824-8.898 0-11.487-4.429-11.487-8.62 0-5.386 4.128-8.895 11.212-8.895 7.085 0 10.568 3.203 10.568 8.414v1.37h-.006zm-3.982-2.727c0-2.246-1.807-3.954-6.41-3.954-4.227 0-6.271 1.432-6.847 4.053h13.257v-.1zM51.319 4.824h4.364l-.069 4.934h.42c1.262-3.44 3.64-5.279 9.092-5.279 6.885 0 9.304 3.309 9.304 7.432v9.745h-4.364v-8.582c0-2.996-1.532-5.01-6.578-5.01-4.09 0-7.805 1.939-7.805 6.03v7.562h-4.364V4.824zM79.232 13.237c0-4.773 3.715-8.758 11.112-8.758s10.293 3.159 10.293 6.806l-3.99.35c-.038-1.908-1.707-3.746-6.234-3.746-4.528 0-6.816 2.352-6.816 5.348 0 2.828 1.77 5.349 6.647 5.349 4.878 0 6.44-1.77 6.472-3.678l3.99.35c0 3.509-2.758 6.737-10.63 6.737-7.874 0-10.844-4.497-10.844-8.758zM105.339 13.274c0-4.428 3.27-8.79 11.556-8.79s11.555 4.362 11.555 8.79c0 4.429-3.201 8.72-11.555 8.72s-11.556-4.26-11.556-8.72zm18.74 0c0-2.797-1.945-5.386-7.19-5.386-5.247 0-7.192 2.59-7.192 5.386 0 2.796 1.907 5.31 7.192 5.31 5.283 0 7.19-2.52 7.19-5.31zM133.084 13.036c0-4.735 3.852-8.552 10.837-8.552 4.74 0 6.978 1.327 7.866 3.648h.388V0h4.364v21.656h-4.364c.068-1.226.137-2.933.168-4.323h-.418c-.819 2.759-3.09 4.667-8.136 4.667-6.815 0-10.699-3.546-10.699-8.964h-.006zm19.084.2v-.512c0-2.658-2.457-4.836-7.635-4.836-4.739 0-7.122 2.214-7.122 5.148 0 3.41 2.621 5.555 7.091 5.555 5.11 0 7.666-3.065 7.666-5.354zM183.384 14.262h-17.377c.306 2.56 1.944 4.636 7.09 4.636 4.466 0 6.035-1.326 6.304-2.728h3.989c-.2 2.935-3.101 5.824-10.293 5.824-8.898 0-11.486-4.429-11.486-8.62 0-5.386 4.127-8.895 11.212-8.895 7.084 0 10.567 3.203 10.567 8.414v1.37h-.006zm-3.989-2.727c0-2.246-1.808-3.954-6.41-3.954-4.227 0-6.272 1.432-6.847 4.053h13.257v-.1zM188.362 4.823h4.364l-.069 5.148h.42c1.056-3.034 3.088-5.487 7.828-5.487 5.559 0 7.666 3.065 7.666 7.77 0 1.295-.068 2.452-.099 2.996h-4.09a22.37 22.37 0 00.068-1.739c0-3.61-1.194-5.448-4.802-5.448-4.465 0-6.916 3.471-6.916 7.225v6.368h-4.364V4.823h-.006z"
    })]
  }));
});
export default Icon;