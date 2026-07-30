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
    viewBox: "0 0 77 24",
    xmlns: "http://www.w3.org/2000/svg"
  }, rest), {}, {
    children: [/*#__PURE__*/_jsx("title", {
      children: TITLE
    }), /*#__PURE__*/_jsx("path", {
      d: "M19.947 8.482H11.43v2.536h6.041c-.298 3.557-3.247 5.074-6.03 5.074-3.562 0-6.67-2.812-6.67-6.753 0-3.839 2.963-6.795 6.677-6.795 2.866 0 4.555 1.833 4.555 1.833l1.77-1.84-.124-.126C17.123 1.898 14.94 0 11.357 0 6.081 0 2 4.468 2 9.294c0 4.729 3.84 9.34 9.491 9.34 4.972 0 8.61-3.417 8.61-8.47a8.69 8.69 0 00-.118-1.507l-.036-.175zm7.013.515c1.719 0 3.347 1.395 3.347 3.642 0 2.199-1.621 3.633-3.355 3.633-1.905 0-3.408-1.53-3.408-3.65 0-2.075 1.485-3.625 3.416-3.625zm-.035-2.352c-3.495 0-6 2.742-6 5.94 0 3.245 2.43 6.038 6.041 6.038 3.27 0 5.948-2.508 5.948-5.968 0-3.877-2.976-5.916-5.793-6.007l-.196-.003zM40.01 8.997c1.72 0 3.348 1.395 3.348 3.642 0 2.199-1.622 3.633-3.356 3.633-1.904 0-3.407-1.53-3.407-3.65 0-2.075 1.484-3.625 3.415-3.625zm-.034-2.352c-3.496 0-6 2.742-6 5.94 0 3.245 2.43 6.038 6.04 6.038 3.27 0 5.949-2.508 5.949-5.968 0-3.877-2.976-5.916-5.793-6.007l-.196-.003zM53.006 9c1.573 0 3.188 1.348 3.188 3.65 0 2.338-1.611 3.628-3.222 3.628-1.71 0-3.302-1.394-3.302-3.607 0-2.299 1.652-3.67 3.336-3.67zm-.232-2.348c-3.208 0-5.73 2.82-5.73 5.984 0 3.605 2.924 5.996 5.675 5.996 1.7 0 2.605-.678 3.273-1.455v1.18c0 2.067-1.25 3.304-3.137 3.304-1.824 0-2.738-1.36-3.056-2.132l-2.293.962c.813 1.726 2.451 3.527 5.368 3.527 3.19 0 5.62-2.016 5.62-6.244V7.012h-2.502v1.014c-.721-.78-1.691-1.306-2.96-1.368l-.258-.007zm16.951 2.29c1.09 0 1.875.581 2.209 1.279l-5.345 2.241c-.23-1.735 1.408-3.52 3.136-3.52zm-.104-2.304c-3.026 0-5.567 2.416-5.567 5.981 0 3.772 2.832 6.01 5.858 6.01 2.525 0 4.075-1.387 5-2.629l-2.063-1.377c-.536.833-1.43 1.648-2.925 1.648-1.678 0-2.45-.922-2.927-1.815L75 11.123l-.415-.976c-.747-1.847-2.454-3.399-4.719-3.504l-.245-.006zM60.24 18.272h2.628V.62H60.24v17.652z"
    })]
  }));
});
export default Icon;