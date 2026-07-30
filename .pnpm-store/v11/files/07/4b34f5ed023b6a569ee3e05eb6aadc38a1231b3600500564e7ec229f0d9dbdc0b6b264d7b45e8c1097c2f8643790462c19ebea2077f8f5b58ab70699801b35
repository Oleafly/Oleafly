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
    fillRule: "nonzero",
    height: size,
    style: _objectSpread({
      flex: 'none',
      lineHeight: 1
    }, style),
    viewBox: "0 0 94 24",
    xmlns: "http://www.w3.org/2000/svg"
  }, rest), {}, {
    children: [/*#__PURE__*/_jsx("title", {
      children: TITLE
    }), /*#__PURE__*/_jsx("path", {
      d: "M85.09 21.999c-1.463 0-2.733-.278-3.811-.834-1.079-.565-1.92-1.412-2.523-2.542-.595-1.13-.892-2.529-.891-4.197 0-1.586.31-2.953.932-4.101.621-1.158 1.48-2.037 2.577-2.639 1.097-.6 2.345-.901 3.743-.901 1.343 0 2.536.291 3.579.874 1.042.584 1.85 1.431 2.426 2.543.585 1.113.878 2.443.878 3.992 0 .556-.005.997-.014 1.325H81.059v-2.87h8.28l-1.562.533c0-.747-.11-1.372-.33-1.873-.21-.51-.52-.893-.931-1.148-.411-.255-.91-.383-1.495-.383-.612 0-1.151.15-1.618.452-.456.291-.813.729-1.069 1.312-.247.583-.37 1.285-.37 2.105v1.408c0 .838.128 1.55.383 2.132.257.583.622 1.026 1.097 1.327.476.29 1.038.437 1.687.437.713 0 1.303-.183 1.769-.547.466-.373.758-.897.877-1.572h4.154c-.128 1.057-.489 1.973-1.083 2.748-.585.775-1.367 1.37-2.344 1.79-.979.42-2.117.629-3.414.629zM72.47 2h4.154v19.602h-4.154V2zm-7.07 19.999c-.786 0-1.49-.137-2.11-.41a4.109 4.109 0 01-1.565-1.23c-.429-.557-.748-1.24-.959-2.051l.44.123v3.171H57.09V7.182h4.154v3.226l-.466.082c.21-.775.53-1.436.96-1.982a4.35 4.35 0 011.603-1.272c.631-.3 1.34-.45 2.125-.45 1.18 0 2.204.305 3.072.915.868.61 1.535 1.49 2.002 2.639.466 1.14.699 2.493.699 4.06 0 1.558-.238 2.912-.713 4.06-.475 1.14-1.156 2.014-2.043 2.623-.877.612-1.905.916-3.085.916zm-1.289-3.157c.622 0 1.143-.183 1.564-.547.429-.365.749-.88.96-1.544.219-.666.328-1.45.328-2.351 0-.902-.11-1.686-.329-2.352-.21-.664-.53-1.18-.96-1.544-.42-.373-.941-.56-1.563-.56-.612 0-1.137.187-1.576.56-.43.364-.755.884-.974 1.558-.22.666-.329 1.445-.329 2.338 0 .901.11 1.685.329 2.35.22.666.545 1.18.974 1.545.439.364.964.547 1.576.547zM57.091 2h4.154v5.18h-4.154v-5.18zM46.664 21.999c-.905 0-1.718-.178-2.44-.533a4.106 4.106 0 01-1.687-1.517c-.402-.666-.603-1.44-.604-2.325 0-1.348.398-2.378 1.193-3.088.795-.72 1.943-1.19 3.441-1.409l2.51-.355c.502-.074.9-.165 1.193-.273.292-.109.507-.255.644-.438.136-.191.205-.433.206-.725 0-.3-.083-.573-.247-.82-.155-.255-.393-.455-.714-.601-.31-.155-.69-.232-1.138-.232-.711 0-1.283.187-1.714.56-.429.364-.662.866-.699 1.504h-4.29c.036-.966.329-1.823.877-2.57.558-.756 1.33-1.344 2.317-1.764.987-.42 2.13-.63 3.428-.628 1.361 0 2.513.223 3.455.67.94.437 1.649 1.066 2.125 1.886.484.82.726 1.8.726 2.939v6.015c0 .646.045 1.248.137 1.804.1.546.242.893.425 1.04v.463H51.49a9.97 9.97 0 01-.233-1.325 16.96 16.96 0 01-.095-1.56l.671-.286a4.593 4.593 0 01-.96 1.79c-.456.539-1.046.972-1.768 1.3-.712.318-1.526.477-2.441.478zm1.536-3.034c.585 0 1.101-.128 1.55-.383.447-.265.79-.63 1.028-1.094.247-.464.37-.993.37-1.586v-1.886l.342.19a2.204 2.204 0 01-.822.67c-.32.157-.755.289-1.303.397l-1.055.205c-.704.138-1.234.347-1.59.63-.348.282-.521.678-.521 1.19 0 .51.187.915.56 1.216.376.3.856.45 1.441.45zM27.805 7.18h4.414l3.798 12.371h-1.33l3.647-12.37h4.29l-5.003 14.42H33l-5.196-14.42zM21.312 22c-1.436 0-2.697-.31-3.784-.93-1.079-.62-1.915-1.503-2.51-2.651-.584-1.149-.877-2.493-.877-4.033 0-1.54.293-2.88.878-4.018.595-1.149 1.43-2.033 2.509-2.653 1.087-.62 2.349-.93 3.784-.93 1.435 0 2.692.31 3.77.93 1.078.62 1.91 1.504 2.495 2.652.594 1.14.891 2.479.891 4.019s-.297 2.884-.892 4.033c-.585 1.148-1.416 2.032-2.494 2.652-1.079.62-2.335.929-3.77.929zm0-3.171c.603 0 1.119-.164 1.549-.492.429-.338.758-.835.987-1.49.229-.665.343-1.486.343-2.461 0-1.449-.252-2.547-.755-3.294-.502-.757-1.21-1.135-2.125-1.135-.602 0-1.123.169-1.563.506-.429.328-.758.824-.986 1.489-.229.657-.343 1.468-.343 2.434 0 .965.114 1.78.343 2.447.228.665.557 1.167.986 1.504.44.328.96.492 1.564.492zM2 2h4.304v16.548l-.767-.889h5.8c3.668 0 3.166 3.943 3.166 3.943H2V2z"
    })]
  }));
});
export default Icon;