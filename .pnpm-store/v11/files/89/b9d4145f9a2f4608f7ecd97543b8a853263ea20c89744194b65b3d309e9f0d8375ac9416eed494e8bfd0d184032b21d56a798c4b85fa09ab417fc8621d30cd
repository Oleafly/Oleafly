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
    viewBox: "0 0 91 24",
    xmlns: "http://www.w3.org/2000/svg"
  }, rest), {}, {
    children: [/*#__PURE__*/_jsx("title", {
      children: TITLE
    }), /*#__PURE__*/_jsx("path", {
      d: "M11.52 19.298C5.914 19.298 2 15.742 2 10.65c0-5.09 3.915-8.649 9.519-8.649 1.416 0 3.075.16 5.628 1.318v3.623c-1.844-1.026-3.665-1.547-5.415-1.547-3.517 0-5.966 2.162-5.966 5.255 0 3.094 2.463 5.254 5.966 5.254 1.704 0 3.574-.529 5.415-1.536v3.612c-2.553 1.157-4.212 1.318-5.627 1.318zm13.128 0c-3.313 0-5.627-2.514-5.627-6.114 0-3.558 2.412-6.14 5.74-6.14 1.838 0 3.117.56 4.143 1.818l.083.102V7.642h3.24v11.393h-3.239v-1.62l-.084.124c-.834 1.199-2.185 1.758-4.254 1.758m1.122-9.54c-1.935 0-3.35 1.44-3.35 3.425 0 1.986 1.406 3.398 3.35 3.398 1.942 0 3.374-1.43 3.374-3.397 0-1.968-1.418-3.425-3.374-3.425zM34.687 24V7.64h3.267v1.422l.084-.117c.628-.878 2.111-1.903 4.233-1.903 3.258 0 5.628 2.583 5.628 6.14 0 3.6-2.323 6.114-5.65 6.114-1.984 0-3.4-.573-4.207-1.7l-.084-.116v6.518h-3.271V24zm6.461-14.242c-1.935 0-3.35 1.439-3.35 3.425 0 1.985 1.407 3.397 3.35 3.397 1.942 0 3.322-1.43 3.322-3.397 0-1.968-1.396-3.425-3.322-3.425zm18.267 9.54c-5.608 0-9.522-3.558-9.522-8.649C49.893 5.558 53.807 2 59.415 2c1.406 0 3.073.16 5.627 1.318V6.94c-1.843-1.025-3.665-1.546-5.413-1.546-3.517 0-5.965 2.162-5.965 5.255 0 3.094 2.461 5.254 5.965 5.254 1.701 0 3.574-.529 5.413-1.536v3.612c-2.553 1.157-4.215 1.318-5.627 1.318zm13.616 0c-3.654 0-6.014-1.724-6.014-4.393V7.303h3.24v6.664c0 1.638 1.038 2.615 2.773 2.615 1.705 0 2.724-.976 2.724-2.614V7.303h3.242v7.602c0 2.67-2.342 4.39-5.965 4.39m13.12 0c-3.592 0-4.865-2.224-4.865-4.128V6.692l3.242-1.704v2.314H89v2.651h-4.472v4.568c0 .613.234 2.04 2.405 2.04.71-.023 1.41-.17 2.067-.438v2.73c-1.133.41-2.466.443-2.85.443z"
    })]
  }));
});
export default Icon;