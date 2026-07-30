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
    viewBox: "0 0 116 24",
    xmlns: "http://www.w3.org/2000/svg"
  }, rest), {}, {
    children: [/*#__PURE__*/_jsx("title", {
      children: TITLE
    }), /*#__PURE__*/_jsx("path", {
      d: "M49.089 8.773h-.023c-.431-1.005-1.677-2.083-3.736-2.083-3.35 0-5.745 2.346-5.745 6.273 0 3.926 2.417 6.32 5.768 6.32 2.13 0 3.232-1.053 3.71-2.225h.024v1.484c0 2.107-1.078 3.112-3.016 3.112-1.628 0-2.704-.576-2.99-1.915h-3.017c.335 2.442 2.587 4.26 6.057 4.26 3.28 0 6.2-1.652 6.2-5.888V7.025h-3.23v1.748h-.002zm-3.066 8.093c-2.227 0-3.353-1.844-3.353-3.878 0-2.035 1.15-3.854 3.353-3.854 2.204 0 3.35 2.083 3.35 3.854 0 1.77-.91 3.878-3.35 3.878zM25.244 11.912c0-3.041-1.436-5.268-5.316-5.268-3.256 0-4.952 2.134-5.312 4.167h2.896c.312-1.15 1.222-1.867 2.443-1.867 1.41 0 2.273.573 2.273 1.555 0 1.053-.766 1.293-2.37 1.532-1.724.262-5.793.597-5.793 3.997 0 2.083 1.629 3.71 4.333 3.71 2.346 0 3.375-1.244 3.878-2.224h.025v.622c0 .406.025.862.096 1.268h3.087c-.17-.791-.239-2.06-.239-3.016v-4.477h-.002zm-2.968 1.749c0 2.873-1.46 3.805-3.04 3.805-1.387 0-2.107-.647-2.107-1.58 0-.934.743-1.436 2.395-1.773 1.818-.358 2.465-.908 2.752-1.507v1.055zM33.91 6.691c-1.915 0-3.014 1.028-3.71 2.466v-2.13h-3.017v12.376h3.087V13.85c0-3.016 1.126-4.477 2.778-4.477 1.772 0 2.25 1.413 2.25 3.209v6.822h3.063v-7.565c0-3.04-1.245-5.147-4.453-5.147h.002zM62.671 4.73c2.322 0 3.902.932 4.812 2.944h3.16C69.59 4.179 66.955 2 62.67 2c-5.194 0-8.714 3.69-8.714 8.882 0 5.193 3.495 8.834 8.69 8.832 4.237 0 7.134-2.273 7.996-5.674H67.46c-.695 1.819-2.179 2.945-4.789 2.945-3.304 0-5.506-2.585-5.506-6.103s2.179-6.151 5.506-6.151v-.002zM110.047 6.691c-1.916 0-3.015 1.028-3.71 2.466v-2.13h-3.016v12.376h3.087V13.85c0-3.016 1.125-4.477 2.776-4.477 1.772 0 2.251 1.413 2.251 3.209v6.822h3.063v-7.565c0-3.04-1.245-5.147-4.453-5.147h.002zM101.237 3.375h-3.182V6.25h3.182V3.375zM98.103 9.17v10.233h3.087V7.026h-.944c-1.184 0-2.143.96-2.143 2.145zM79.117 6.689c-1.915 0-3.014 1.03-3.71 2.442V2.31H72.39v17.088h3.087v-5.555c0-3.015 1.126-4.476 2.777-4.476 1.773 0 2.25 1.412 2.25 3.208v6.823h3.064v-7.566c0-3.039-1.246-5.146-4.453-5.146l.001.002zM96.092 11.912c0-3.041-1.436-5.268-5.316-5.268-3.257 0-4.952 2.134-5.31 4.167h2.896c.312-1.15 1.223-1.867 2.442-1.867 1.41 0 2.273.573 2.273 1.555 0 1.053-.765 1.293-2.368 1.532-1.725.262-5.794.597-5.794 3.997 0 2.083 1.629 3.71 4.332 3.71 2.347 0 3.376-1.244 3.879-2.224h.022v.622c0 .406.024.862.097 1.268h3.087c-.168-.791-.239-2.06-.239-3.016l-.001-4.477zm-2.97 1.749c0 2.873-1.459 3.805-3.039 3.805-1.388 0-2.107-.647-2.107-1.58 0-.934.743-1.436 2.393-1.773 1.82-.358 2.466-.908 2.754-1.507v1.055zM5.101 13.727V2.31H2v13.57h.948c1.19 0 2.153-.963 2.153-2.153zM13.1 16.663H2v2.741h11.1v-2.741z"
    })]
  }));
});
export default Icon;