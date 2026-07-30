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
    viewBox: "0 0 141 24",
    xmlns: "http://www.w3.org/2000/svg"
  }, rest), {}, {
    children: [/*#__PURE__*/_jsx("title", {
      children: TITLE
    }), /*#__PURE__*/_jsx("path", {
      d: "M2 2.358h10.15c3.292 0 5.7.634 7.227 1.9 1.544 1.25 2.317 3.242 2.317 5.979v3.554c0 2.718-.773 4.71-2.317 5.978-1.526 1.248-3.935 1.873-7.227 1.873H2V2.358zm5.461 14.876h3.696c1.287 0 2.207-.257 2.758-.771.57-.514.856-1.36.856-2.535v-3.856c0-1.176-.286-2.02-.856-2.535-.551-.514-1.47-.771-2.758-.771H7.461l1.462-3.278v17.08l-1.462-3.334zM34.745 22c-2.151 0-3.999-.33-5.544-.992-1.526-.66-2.703-1.607-3.53-2.837-.828-1.25-1.241-2.737-1.241-4.463v-3.416c0-1.726.413-3.205 1.24-4.435.828-1.25 2.005-2.204 3.531-2.865C30.746 2.33 32.594 2 34.745 2c2.17 0 4.027.33 5.572.992 1.545.66 2.721 1.616 3.53 2.865.828 1.23 1.242 2.709 1.242 4.435v3.416c0 1.726-.414 3.214-1.242 4.463-.809 1.23-1.985 2.176-3.53 2.837-1.545.661-3.402.992-5.572.992zm0-4.628c1.14 0 1.986-.312 2.538-.937.57-.642.855-1.625.855-2.947v-2.976c0-1.322-.285-2.295-.855-2.92-.552-.643-1.398-.964-2.538-.964-1.121 0-1.967.321-2.537.964-.57.625-.855 1.598-.855 2.92v2.976c0 1.322.285 2.305.855 2.947.57.625 1.416.937 2.537.937zM53.304 17.014h8.965v4.628h-14.37V2.358h6.922v18.21l-1.517-3.554zM63.844 2.358h10.399c2.464 0 4.358.542 5.682 1.625 1.342 1.084 2.013 2.636 2.013 4.656v1.873c0 1.984-.662 3.508-1.986 4.573-1.324 1.066-3.227 1.598-5.71 1.598h-3.75v-4.628h2.151c.846 0 1.49-.193 1.93-.578.442-.405.663-1.001.663-1.791v-.33c0-.79-.22-1.378-.662-1.764-.423-.404-1.067-.606-1.931-.606h-3.42l1.544-1.46v16.116h-6.923V2.358zM84.53 2.358h6.924v10.028l-1.517-2.672h10.04l-1.49 2.672V2.358h6.924v19.284h-6.924V11.614l1.49 2.728h-10.04l1.517-2.728v10.028h-6.923V2.358zM115.211 2.358v19.284h-6.923V2.358h6.923zM139 2.358v19.284h-7.558l-6.316-8.788h-.11v8.788h-6.923V2.358h7.557l6.317 8.788h.11V2.358H139z"
    })]
  }));
});
export default Icon;