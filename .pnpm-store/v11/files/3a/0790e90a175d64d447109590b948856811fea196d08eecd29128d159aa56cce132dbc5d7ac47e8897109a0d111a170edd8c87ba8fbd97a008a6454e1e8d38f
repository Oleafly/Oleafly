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
    viewBox: "0 0 140 24",
    xmlns: "http://www.w3.org/2000/svg"
  }, rest), {}, {
    children: [/*#__PURE__*/_jsx("title", {
      children: TITLE
    }), /*#__PURE__*/_jsx("path", {
      clipRule: "evenodd",
      d: "M13.075 16.36c0-4.47-10.605-.758-10.605-8.238 0-3.93 3.527-5.746 6.673-5.746 2.333 0 4.313.731 6.184 2.276l-1.438 2.44c-1.438-1.355-2.956-1.979-4.746-1.979-1.628 0-3.553.895-3.553 2.9 0 4.472 10.605.758 10.605 8.238 0 4.012-3.608 5.746-6.954 5.746-2.848 0-5.506-1.056-7.241-3.278l1.501-2.575c1.735 2.168 3.58 3.116 5.722 3.116 1.817 0 3.852-.84 3.852-2.9zm5.495-8.236h2.984v13.551h-2.983V8.125zM20.063 2c1.004 0 1.763.732 1.763 1.762s-.76 1.761-1.763 1.761c-1.004 0-1.763-.732-1.763-1.761 0-1.03.76-1.762 1.763-1.762zm4.648.703h2.983v18.972H24.71V2.703zm6.146 5.421h2.983v13.551h-2.983V8.125zM32.347 2c1.004 0 1.763.732 1.763 1.762s-.76 1.761-1.763 1.761c-1.004 0-1.763-.732-1.763-1.761 0-1.03.76-1.762 1.763-1.762zm3.855 12.897c0-4.12 3.064-7.1 7.268-7.1 2.333 0 4.367 1.003 5.615 2.522l-2.224 1.813c-.732-.921-1.953-1.571-3.39-1.571-2.468 0-4.285 1.788-4.285 4.336s1.817 4.337 4.284 4.337c1.438 0 2.658-.65 3.39-1.572l2.225 1.817C47.837 20.995 45.695 22 43.47 22c-4.204 0-7.268-2.981-7.268-7.101v-.002zm21.01-4.336c-2.495 0-4.285 1.896-4.285 4.336 0 2.44 1.79 4.337 4.285 4.337s4.285-1.897 4.285-4.337c0-2.44-1.79-4.336-4.285-4.336zm0-2.765c4.122 0 7.268 3.01 7.268 7.101 0 4.093-3.146 7.101-7.268 7.101-4.123 0-7.268-3.008-7.268-7.1 0-4.093 3.145-7.102 7.268-7.102zm12.57 6.589v7.29H66.8V8.125h2.983v2.14C70.568 8.64 72.303 7.8 74.094 7.8c3.064 0 5.397 2.114 5.397 6.097v7.29h-2.984v-7.67c0-2.194-1.302-3.388-3.2-3.388-2.034 0-3.526 1.355-3.526 3.768l.001.488zm16.017 7.29h-3.118V2.703h12.07V5.55H85.8v5.42h7.974v2.792H85.8v7.914zM96.592 2.703h2.983v18.972h-2.983V2.703zm12.555 7.858c-2.495 0-4.285 1.896-4.285 4.336 0 2.44 1.79 4.337 4.285 4.337s4.284-1.897 4.284-4.337c0-2.44-1.789-4.336-4.284-4.336zm0-2.765c4.122 0 7.268 3.01 7.268 7.101 0 4.093-3.146 7.101-7.268 7.101-4.123 0-7.268-3.008-7.268-7.1 0-4.093 3.145-7.102 7.268-7.102zm25.933.328H138l-3.701 13.551h-3.961l-2.603-10.083-2.775 10.083h-3.961l-3.556-13.551h2.977l2.661 10.816 2.949-10.817h3.412l2.833 10.816 2.805-10.815z"
    })]
  }));
});
export default Icon;