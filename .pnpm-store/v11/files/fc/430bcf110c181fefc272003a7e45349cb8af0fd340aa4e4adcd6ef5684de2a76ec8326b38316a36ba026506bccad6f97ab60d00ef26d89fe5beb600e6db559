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
      d: "M6.47 17l-.367-1.189H2.718L2.35 17H0l3.398-9.789h2.026L8.864 17H6.47zm-2.052-6.993l-1.17 4.028H5.56l-1.142-4.028zm4.707-2.796h2.23V17h-2.23V7.211zM11.955 15c.1-.483.277-.946.524-1.37.214-.359.482-.68.795-.951.32-.273.658-.52 1.013-.741.28-.168.54-.33.781-.483.222-.14.433-.296.632-.468.172-.148.317-.325.428-.525.107-.199.16-.423.157-.65 0-.392-.104-.674-.313-.846a1.176 1.176 0 00-.775-.259 1.207 1.207 0 00-.863.329c-.231.219-.347.585-.347 1.098H11.8a3.387 3.387 0 01.224-1.245c.146-.377.371-.716.66-.993.306-.29.667-.514 1.06-.657A4.04 4.04 0 0115.183 7c.42-.002.84.057 1.244.175.376.107.73.287 1.04.531.305.246.55.562.714.923.185.419.275.875.265 1.335.005.39-.084.774-.259 1.12-.167.328-.38.63-.632.894-.246.259-.517.49-.808.693-.29.2-.554.37-.789.51-.326.224-.596.417-.809.58a3.872 3.872 0 00-.51.455 1.229 1.229 0 00-.265.434 1.633 1.633 0 00-.074.517h4.078V17h-6.606a9.24 9.24 0 01.183-2zM18.8 8.93a5.05 5.05 0 001.135-.105c.25-.049.484-.156.686-.314.163-.139.28-.324.34-.532.068-.25.1-.51.095-.77H23V17h-2.243v-6.475H18.8V8.93z"
    })]
  }));
});
export default Icon;