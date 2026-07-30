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
    viewBox: "0 0 133 24",
    xmlns: "http://www.w3.org/2000/svg"
  }, rest), {}, {
    children: [/*#__PURE__*/_jsx("title", {
      children: TITLE
    }), /*#__PURE__*/_jsx("path", {
      d: "M3.266 21.477h4.979v-2.483h-1.66V8.797H2v2.528h1.266v10.152zm.917-15.686c.306.174.612.261.961.261.35 0 .655-.087.96-.261a1.79 1.79 0 00.7-.697c.174-.305.262-.61.262-.959s-.088-.654-.262-.959c-.175-.305-.437-.566-.743-.697a1.837 1.837 0 00-.917-.261c-.305 0-.611.087-.96.261-.306.175-.568.392-.743.697-.175.305-.262.61-.262.96 0 .348.087.696.262.958.218.261.437.523.742.697zm16.158-3.355H8.638v2.57h1.965v5.621H8.507l-1.31 2.528h3.45v8.496h3.319v-8.54h1.44l1.18-2.527h-2.62V5.007h3.1V21.52h4.804v-2.44H20.34V2.436zm8.69 16.645l4.411-16.689h-9.214v2.484h5.066l-4.411 16.601H43.18v-2.396H29.032zm2.97-10.11h5.11l6.55-6.187h-4.498L32 8.972zm.087 2.049l6.245 5.708h4.891L36.98 11.02h-4.89zm31.093 10.893V12.85h2.315l.043-2.353h-2.358V4.963l2.184-.044.043-2.396H46.15v2.44h2.27v5.534h-2.357v2.353h2.401v8.976l3.494.043v-9.02h7.773v9.064h3.45zM51.914 10.497V4.963h7.773v5.49h-7.773v.044zm30.089-8.148h-3.144L77.33 7.534h3.232l.567-1.874h5.372l1.091-2.396h-5.851l.262-.915zm5.022 4.618h-3.232l-1.528 3.704-1.136-2.57h-3.275l2.751 6.535-2.882 7.059h3.363l1.222-3.05 1.267 3.05h3.493l-3.1-7.102 3.057-7.626zM72.002 22V9.32h2.01v9.848h-.787v2.396H77.2V6.924h-5.153V5.747h4.891l.873-2.396h-3.319l-.305-.48c-.088-.174-.306-.305-.612-.435-.305-.131-.61-.218-.96-.175-.35 0-.655.088-.917.218-.262.131-.524.436-.83.915h-2.97v2.397h.917V22h3.188zM93.444 6.096H90.17l2.926 8.235h3.319l-2.97-8.235zm12.228 8.235l2.969-8.235h-3.275l-3.013 8.235h3.319zm-4.367 1.525V4.963h8.035l-.044-2.484H90.213v2.484h7.554v10.893h-7.773v2.484h7.773v3.224h3.45V18.34h8.298v-2.484h-8.21zm26.07-5.795H131l-1.048-5.839h-3.406l.655 3.312h-10.525L119.995 2h-4.105l-3.843 5.62v2.441h15.328zm-15.328 11.242h18.604V11.28h-18.604v10.022zm3.494-7.538h11.616v4.967h-11.616v-4.967z"
    })]
  }));
});
export default Icon;