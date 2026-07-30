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
    viewBox: "0 0 120 24",
    xmlns: "http://www.w3.org/2000/svg"
  }, rest), {}, {
    children: [/*#__PURE__*/_jsx("title", {
      children: TITLE
    }), /*#__PURE__*/_jsx("path", {
      d: "M8.472 5.521c3.499 0 6.403 2.699 6.403 6.29 0 3.613-2.835 6.38-6.426 6.38C4.927 18.19 2 15.47 2 11.856c0-3.613 2.927-6.335 6.472-6.335zm0 10.2c2.218 0 3.636-1.76 3.636-3.865 0-2.104-1.44-3.865-3.659-3.865-2.195 0-3.659 1.715-3.659 3.82 0 2.08 1.464 3.91 3.682 3.91zM22.613 18.169c-.937 0-2.995-.48-3.956-1.967V24h-2.721V5.774h2.653v1.898c1.029-1.67 3.018-2.127 4.093-2.127 3.75 0 5.992 3.224 5.992 6.289 0 3.316-2.447 6.335-6.06 6.335zm-.343-2.47c2.196 0 3.66-1.738 3.66-3.842s-1.441-3.865-3.66-3.865c-2.218 0-3.658 1.76-3.658 3.865 0 2.104 1.44 3.842 3.659 3.842zM32.426 12.68c.046 1.875 1.784 3.178 3.568 3.178 1.487 0 2.584-.549 3.293-1.898l1.967 1.304c-1.052 1.944-3.087 2.95-5.214 2.95-3.614 0-6.403-2.722-6.403-6.358 0-3.453 2.607-6.335 6.151-6.335 3.797 0 5.946 2.63 5.946 6.312 0 .115 0 .55-.046.847h-9.262zm.138-2.059h6.403c-.091-1.738-1.486-2.767-3.179-2.767-1.67 0-2.973 1.098-3.224 2.767zM51.344 11.147c0-1.738-.823-3.041-2.698-3.041-1.715 0-2.813 1.235-2.813 3.087v6.792h-2.721V5.773h2.652V7.42a4.586 4.586 0 013.728-1.899c3.11 0 4.574 2.173 4.574 4.94v7.524h-2.722v-6.838zM62.49 8.518a5.37 5.37 0 00-.777-.069c-2.081 0-3.18 1.235-3.18 3.34v6.197h-2.72V5.774h2.652v1.943C59.22 6.345 60.5 5.66 61.827 5.66c.16 0 .503.023.663.069v2.79zM69.283 5.521c3.498 0 6.403 2.699 6.403 6.29 0 3.613-2.836 6.38-6.426 6.38-3.522 0-6.45-2.721-6.45-6.335 0-3.613 2.928-6.335 6.473-6.335zm0 10.2c2.218 0 3.636-1.76 3.636-3.865 0-2.104-1.441-3.865-3.66-3.865-2.195 0-3.658 1.715-3.658 3.82 0 2.08 1.463 3.91 3.682 3.91zM79.693 12.611c0 1.738.823 3.042 2.699 3.042 1.715 0 2.813-1.235 2.813-3.088V5.774h2.721v12.212h-2.653V16.34a4.586 4.586 0 01-3.727 1.898c-3.065 0-4.574-2.173-4.574-4.963v-7.5h2.721v6.837zM94.376 13.617c0 1.51.754 2.036 2.104 2.036.251 0 .525-.023.868-.092v2.31c-.48.183-1.12.252-1.463.252-2.63 0-4.23-1.373-4.23-4.071V8.22h-2.242V5.773h2.241V2h2.722v3.773h2.995V8.22h-2.995v5.397zM100.578 12.68c.046 1.875 1.784 3.178 3.568 3.178 1.486 0 2.584-.549 3.293-1.898l1.967 1.304c-1.052 1.944-3.088 2.95-5.214 2.95-3.614 0-6.404-2.722-6.404-6.358 0-3.453 2.607-6.335 6.152-6.335 3.796 0 5.946 2.63 5.946 6.312 0 .115 0 .55-.046.847h-9.262zm.137-2.059h6.404c-.092-1.738-1.487-2.767-3.179-2.767-1.67 0-2.973 1.098-3.225 2.767zM117.759 8.518a5.357 5.357 0 00-.777-.069c-2.081 0-3.179 1.235-3.179 3.34v6.197h-2.721V5.774h2.653v1.943c.754-1.372 2.035-2.058 3.361-2.058.16 0 .503.023.663.069v2.79z"
    })]
  }));
});
export default Icon;