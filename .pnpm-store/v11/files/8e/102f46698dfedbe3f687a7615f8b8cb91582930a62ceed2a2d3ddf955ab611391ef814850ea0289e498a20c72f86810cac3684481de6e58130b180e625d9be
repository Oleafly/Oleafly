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
    viewBox: "0 0 92 24",
    xmlns: "http://www.w3.org/2000/svg"
  }, rest), {}, {
    children: [/*#__PURE__*/_jsx("title", {
      children: TITLE
    }), /*#__PURE__*/_jsx("path", {
      d: "M10.831 6.145l-.822.768h-.823L8.93 5.94c-.055-.24-.293-.393-.567-.393H3.097c-.33 0-.585.239-.585.512V7.75c0 .29.256.512.585.512h3.108v7.924h-3.62c-.329 0-.585.24-.585.513v1.69c0 .29.256.513.585.513h11.391c.33 0 .585-.24.585-.512v-1.691c0-.29-.256-.513-.585-.513H9.79v-5.601c0-1.571.988-2.391 2.926-2.391h3.145c.329 0 .585-.24.585-.512V5.82c0-.29-.256-.512-.585-.512h-1.865c-1.372-.017-2.45.222-3.164.837zM24.348 5.307c-4.596 0-7.059 2.38-7.059 7.213 0 4.85 2.444 7.232 6.968 7.232 3.502 0 5.763-1.422 6.365-3.856.091-.338-.2-.657-.565-.657h-2.189a.598.598 0 00-.547.355c-.383 1.048-1.478 1.546-2.955 1.546-2.298 0-3.392-1.226-3.538-4.087h9.976c.548-5.347-1.732-7.746-6.456-7.746zm-3.41 5.579c.346-2.097 1.422-3.074 3.392-3.074 2.097 0 3.082 1.084 3.137 3.074h-6.53zM41.517 5.307c-1.187 0-2.042.255-2.706.867l-.82.766h-.751l-.28-.987a.564.564 0 00-.54-.39h-1.572c-.314 0-.559.237-.559.51V23.49c0 .289.245.51.56.51h2.304c.314 0 .558-.238.558-.51v-3.776l-.296-2.024.768-.17.82.765c.646.578 1.432.867 2.602.867 3.387 0 5.43-2.279 5.43-6.922-.018-4.644-2.043-6.923-5.517-6.923zm-1.134 11.056c-1.729 0-2.689-.867-2.689-2.517V10.58c0-1.65.943-2.518 2.689-2.518 2.112 0 3.072 1.293 3.072 4.134-.017 2.874-.96 4.167-3.072 4.167zM89.517 7.305v-1.76c0-.301-.25-.532-.57-.532h-6.172V1.6c0-.302-.25-.533-.57-.533h-2.347c-.32 0-.57.25-.57.533v3.413h-3.646c-.32 0-.57.249-.57.533v1.76c0 .301.25.532.57.532h3.647v5.226c0 3.998 1.885 5.847 5.94 5.847h3.31c.32 0 .569-.25.569-.534v-1.759c0-.302-.25-.533-.57-.533h-2.774c-2.207 0-2.99-.871-2.99-3.04V7.857h6.174c.32-.018.569-.266.569-.55zM60.926 16.17H57.36V.734c0-.293-.245-.517-.56-.517h-6.993c-.315 0-.56.241-.56.517v1.708c0 .293.245.517.56.517h4.126v13.21H49.3c-.315 0-.56.24-.56.516v1.708c0 .293.245.517.56.517h11.626c.315 0 .56-.241.56-.517v-1.707c0-.294-.245-.518-.56-.518zM71.009 0h-3.164c-.317 0-.563.246-.563.527V2.76c0 .299.246.527.563.527h3.164c.316 0 .562-.246.562-.527V.527A.56.56 0 0071.01 0zM71.436 16.259V5.834c0-.298-.246-.527-.563-.527H63.79c-.316 0-.562.246-.562.527v1.74c0 .3.246.528.562.528h4.201v8.157h-4.2c-.317 0-.563.246-.563.527v1.74c0 .3.246.528.562.528h11.954c.316 0 .562-.246.562-.528v-1.74c0-.299-.246-.527-.562-.527h-4.307z"
    })]
  }));
});
export default Icon;