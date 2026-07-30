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
    viewBox: "0 0 81 24",
    xmlns: "http://www.w3.org/2000/svg"
  }, rest), {}, {
    children: [/*#__PURE__*/_jsx("title", {
      children: TITLE
    }), /*#__PURE__*/_jsx("path", {
      clipRule: "evenodd",
      d: "M2 0l2.588 1.763v5.66H4.9A5.841 5.841 0 019.858 4.8c3.991 0 6.548 2.906 6.548 6.937v9.469h-2.588v-9.469c0-2.687-1.59-4.593-4.303-4.593-2.65 0-4.926 2.031-4.926 4.843v9.219H2L2 0zm16.251 13.112c0-4.813 3.493-8.313 8.357-8.313 4.802 0 8.263 3.5 8.263 8.344 0 .313 0 .688-.03 1.03H20.9c.374 3.188 2.682 5.313 5.894 5.313 2.339 0 4.397-1.187 5.394-3.062l2.152 1.093c-1.278 2.687-4.117 4.313-7.608 4.313-4.927 0-8.482-3.656-8.482-8.719zm13.907-1.22c-.468-2.843-2.681-4.75-5.675-4.75-2.9 0-5.114 1.907-5.55 4.75h11.225zM44.297 4.8c-4.615 0-8.139 3.563-8.139 8.5 0 4.937 3.555 8.53 8.17 8.53 2.557 0 4.584-1.124 5.737-3.062h.312v2.438h2.588V0l-2.588 1.763v6.005h-.312c-1.153-1.906-3.242-2.969-5.768-2.969zm.312 2.344c3.367 0 5.83 2.687 5.83 6.156s-2.463 6.187-5.83 6.187c-3.368 0-5.863-2.656-5.863-6.187 0-3.469 2.464-6.156 5.863-6.156zm11.265-1.72H58.4V7.55h.28c.718-1.438 2.464-2.438 4.21-2.438a4.428 4.428 0 011.934.406v2.406a6.453 6.453 0 00-2.339-.469c-2.37 0-4.022 2.125-4.022 5.25v8.5h-2.588l-.001-15.78zm16.173 6.407C67.37 12.361 65 14.424 65 17.205c0 2.719 2.245 4.5 5.642 4.5 2.526 0 4.366-1 5.488-2.813h.282v2.313H79V10.737c0-3.594-2.588-5.907-6.673-5.907-3.96 0-6.548 2.125-6.548 5.469h2.62c-.032-1.969 1.527-3.125 3.897-3.125 2.59 0 4.117 1.375 4.117 3.5v.625l-4.366.531zm4.366 1.688v1.406c0 2.656-2.183 4.625-5.394 4.625-2.121 0-3.43-.907-3.43-2.407 0-1.468 1.247-2.719 4.458-3.124l4.366-.5z"
    })]
  }));
});
export default Icon;