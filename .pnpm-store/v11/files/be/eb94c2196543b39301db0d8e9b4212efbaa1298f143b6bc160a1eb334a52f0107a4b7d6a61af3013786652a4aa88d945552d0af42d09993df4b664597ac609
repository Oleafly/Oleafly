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
    viewBox: "0 0 108 24",
    xmlns: "http://www.w3.org/2000/svg"
  }, rest), {}, {
    children: [/*#__PURE__*/_jsx("title", {
      children: TITLE
    }), /*#__PURE__*/_jsx("path", {
      clipRule: "evenodd",
      d: "M2 19.138h12.31V15.96H5.887V2.289H2v16.849zm20.277.192c4.103 0 7.079-2.768 7.079-6.667 0-3.9-2.976-6.667-7.08-6.667-4.102 0-7.102 2.768-7.102 6.667 0 3.9 3 6.667 7.103 6.667zm0-3.08c-1.872 0-3.312-1.348-3.312-3.587s1.44-3.586 3.312-3.586c1.872 0 3.287 1.348 3.287 3.586 0 2.239-1.415 3.587-3.287 3.587zM39.698 5.996c-1.752 0-3.263.601-4.271 1.709V6.188H31.85v12.95h3.744v-6.403c0-2.383 1.296-3.49 3.095-3.49 1.656 0 2.616.963 2.616 3.057v6.836h3.743v-7.414c0-3.947-2.303-5.728-5.35-5.728zm18.645.192V7.85c-.984-1.252-2.471-1.853-4.271-1.853-3.576 0-6.455 2.479-6.455 6.258s2.88 6.258 6.455 6.258c1.68 0 3.095-.53 4.08-1.613v.554c0 2.335-1.153 3.538-3.792 3.538-1.656 0-3.456-.577-4.56-1.468l-1.487 2.696C49.825 23.399 52.2 24 54.648 24c4.655 0 7.247-2.214 7.247-7.028V6.188h-3.552zm-3.527 9.243c-1.968 0-3.408-1.276-3.408-3.177 0-1.902 1.44-3.177 3.408-3.177s3.383 1.275 3.383 3.177c0 1.901-1.415 3.177-3.383 3.177zm18.861 3.996c2.927 0 5.351-1.06 6.935-3.01l-2.496-2.31c-1.127 1.324-2.543 1.998-4.223 1.998-3.144 0-5.375-2.214-5.375-5.392 0-3.177 2.231-5.391 5.375-5.391 1.68 0 3.096.674 4.223 1.973l2.496-2.31C79.028 3.059 76.605 2 73.7 2c-5.231 0-9.119 3.635-9.119 8.713 0 5.08 3.888 8.714 9.095 8.714zM88.075 5.996c-2.064 0-4.152.553-5.567 1.564l1.343 2.624c.936-.746 2.352-1.204 3.72-1.204 2.016 0 2.975.939 2.975 2.552h-2.975c-3.936 0-5.543 1.588-5.543 3.875 0 2.238 1.8 3.923 4.823 3.923 1.896 0 3.24-.625 3.935-1.805v1.613h3.504v-7.39c0-3.923-2.28-5.752-6.215-5.752zm-.288 10.807c-1.32 0-2.112-.626-2.112-1.565 0-.866.552-1.516 2.304-1.516h2.567v1.324c-.432 1.18-1.511 1.757-2.76 1.757zm17.205-.939c-.408.313-.96.482-1.512.482-1.007 0-1.607-.602-1.607-1.71v-5.27h3.215V6.476h-3.215V3.324h-3.744v3.153h-1.992v2.888h1.992v5.32c0 3.08 1.776 4.645 4.823 4.645 1.152 0 2.28-.264 3.048-.818l-1.008-2.648z"
    })]
  }));
});
export default Icon;