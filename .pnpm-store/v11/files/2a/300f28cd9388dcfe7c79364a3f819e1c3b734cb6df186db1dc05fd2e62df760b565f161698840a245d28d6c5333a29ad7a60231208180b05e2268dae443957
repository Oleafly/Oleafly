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
      clipRule: "evenodd",
      d: "M2.93 18.812a.79.79 0 01.45.142v-.002c.944.7 1.97 1.28 3.058 1.727a13.955 13.955 0 008.47.665c1.22-.288 2.397-.74 3.496-1.344.567-.311 1.113-.66 1.632-1.046a.787.787 0 01.327-.131l.123-.01c.444 0 .804.371.804.829 0 .14-.034.276-.1.399.03-.015.06-.032.09-.049l-.166.167a.82.82 0 01-.174.166C18.501 22.608 15.26 24 11.71 24c-3.55 0-6.787-1.389-9.223-3.668l-.19-.181a.842.842 0 01-.17-.51c0-.457.36-.829.804-.829H2.93zM5.536 0c.461.047.91.178 1.324.388a4.561 4.561 0 014.119.954 4.828 4.828 0 011.653 3.09l.856 5.005.1.586 2.1.411c.387.075.746.23 1.06.446.085-.155.185-.3.299-.433a2.39 2.39 0 011.818-.845c.84 0 1.581.441 2.016 1.11.243.373.391.816.409 1.293h.006a3.04 3.04 0 001.204 2.277c-.352.3-.8.467-1.262.469-.466 0-.893-.167-1.231-.444a2.032 2.032 0 01-.716-1.238l-.01.002c-.158-.905-.926-1.592-1.85-1.592l-.043.001a3.04 3.04 0 01.464 2.893c-.13.365-.327.695-.577.976l.022.002a3.266 3.266 0 00-.401 2.829l.557 1.9c-.862.403-1.764.713-2.692.926l-1.604-3.696a2.31 2.31 0 001.301-.62 2.81 2.81 0 01-1.624-.127c-.033-.013-.064-.025-.095-.039l-.377-.132-1.691-.621-1.257-.462-2.598 1.726.596 2.187H7.41c.023.093.035.192.035.293 0 .407-.202.765-.508.975a13.504 13.504 0 01-1.23-.531l-.334-1.112-.662-2.206a1.12 1.12 0 01.067-.915 1.1 1.1 0 01.375-.4l1.482-1.04-2.626-.964-.437 1.786H3.57c-.202.81-.916 1.41-1.766 1.41a1.8 1.8 0 01-.304-.027l.002-.014.785-3.216.1-.404.222-.91h.003a1.113 1.113 0 011.071-.854c.088 0 .172.01.253.03l.004.002.016.005c.238.073.476.148.713.223.444.14.93.3.956.326l.07-.212.275-.836.364-1.104.67-2.027.453-1.375a3.12 3.12 0 00.708-.866c.184-.332.313-.701.371-1.094-.165.43-.445.807-.808 1.09L6.7 5.718l-1.93.866-.011.005a.948.948 0 01-.325.075l-.054.003a.982.982 0 01-.884-.57 1.03 1.03 0 01.145-1.116l.424-.643L5.874 1.6 5.718.86 5.704.793 5.646.516 5.536 0z"
    })]
  }));
});
export default Icon;