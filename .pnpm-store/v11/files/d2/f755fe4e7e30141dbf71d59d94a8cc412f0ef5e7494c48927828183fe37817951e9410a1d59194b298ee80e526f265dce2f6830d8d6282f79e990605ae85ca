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
    viewBox: "0 0 78 24",
    xmlns: "http://www.w3.org/2000/svg"
  }, rest), {}, {
    children: [/*#__PURE__*/_jsx("title", {
      children: TITLE
    }), /*#__PURE__*/_jsx("path", {
      d: "M2 22.63V19.09h4.064c.7 0 1.268-.216 1.7-.649.433-.432.65-.999.65-1.699V1H12.2v16.176c0 1.07-.237 2.023-.711 2.858a4.792 4.792 0 01-1.978 1.915c-.856.454-1.834.68-2.937.68H2zM27.1 6.808h3.677v15.82h-3.585v-2.472c-.495.927-1.17 1.633-2.025 2.117S23.344 23 22.262 23c-1.133 0-2.133-.247-2.998-.742-.866-.494-1.54-1.21-2.025-2.147-.484-.937-.726-2.055-.726-3.353V6.81h3.662v9.378c0 1.143.29 2.029.866 2.657.587.618 1.406.927 2.457.927.7 0 1.324-.16 1.87-.479a3.358 3.358 0 001.268-1.36c.309-.576.463-1.235.463-1.977V6.81zm16.48-.37c1.134 0 2.133.246 2.999.74.875.495 1.555 1.211 2.039 2.148.485.938.727 2.055.727 3.353v9.95h-3.678V13.25c0-1.143-.294-2.024-.881-2.641-.577-.629-1.391-.943-2.442-.943-.7 0-1.324.165-1.87.495a3.36 3.36 0 00-1.283 1.344c-.299.576-.448 1.236-.448 1.977v9.146H35.08V6.81h3.57v2.472c.495-.927 1.17-1.633 2.025-2.117s1.824-.726 2.906-.726zm13.375 16.19h-3.678V6.81h3.678v15.82zM53.107 4.492V1h3.987v3.492h-3.987zM76 15.708H63.93c.104.824.356 1.55.758 2.178a4.3 4.3 0 001.545 1.468c.629.34 1.33.51 2.102.51.907 0 1.674-.134 2.303-.402.628-.268 1.112-.654 1.452-1.159h3.632c-.165.773-.572 1.52-1.221 2.24-.65.722-1.514 1.314-2.596 1.777-1.082.453-2.318.68-3.71.68-1.544 0-2.935-.355-4.172-1.066a7.541 7.541 0 01-2.874-2.95c-.69-1.268-1.035-2.694-1.035-4.28 0-1.566.35-2.977 1.05-4.234a7.65 7.65 0 012.89-2.95c1.236-.721 2.617-1.082 4.142-1.082 1.566 0 2.936.356 4.11 1.066a7.14 7.14 0 012.736 2.951c.639 1.246.958 2.662.958 4.249v1.004zm-7.789-6.226c-1.112 0-2.05.33-2.812.989-.752.659-1.231 1.555-1.438 2.688h8.268c-.185-1.133-.623-2.03-1.313-2.689-.68-.659-1.582-.988-2.705-.988z"
    })]
  }));
});
export default Icon;