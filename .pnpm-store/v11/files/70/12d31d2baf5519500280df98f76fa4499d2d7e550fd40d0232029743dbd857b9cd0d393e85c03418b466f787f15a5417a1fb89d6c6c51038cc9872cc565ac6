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
    viewBox: "0 0 44 24",
    xmlns: "http://www.w3.org/2000/svg"
  }, rest), {}, {
    children: [/*#__PURE__*/_jsx("title", {
      children: TITLE
    }), /*#__PURE__*/_jsx("path", {
      d: "M5.12 9.182a39.768 39.768 0 01-1.923 1.695L2 8.695a23.043 23.043 0 003.077-3.136C6.046 4.387 6.843 3.201 7.47 2l2.286.975a32.887 32.887 0 01-2.05 3.262v7.521H5.12V9.183zm3.483-1.186a60.35 60.35 0 003.12-.911V2.487h2.606v3.58a37.324 37.324 0 005.3-2.86l1.196 2.14a32.814 32.814 0 01-6.496 3.39v.911c0 .438.078.735.235.89.171.155.47.247.897.276.214.014.535.02.962.02.527 0 .926-.013 1.197-.042.512-.042.847-.134 1.004-.275.17-.141.285-.43.342-.869.071-.678.107-1.3.107-1.864l2.371.678c-.042.763-.092 1.44-.15 2.034-.113.72-.277 1.257-.49 1.61-.2.353-.506.607-.92.763-.398.14-.997.24-1.794.296a27.914 27.914 0 01-3.76 0c-.642-.056-1.148-.162-1.518-.317a1.703 1.703 0 01-.833-.806c-.171-.381-.257-.91-.257-1.589v-.762c-.655.226-1.431.466-2.329.72l-.79-2.415zm4.572 6.991h8.29v2.543h-8.29v4.428h-2.65V17.53H2.279v-2.543h8.248v-1.695h2.65v1.695zM42 6.83v.636c0 2.048-.05 4.047-.15 5.996-.1 1.935-.263 3.602-.491 5-.128.763-.328 1.356-.598 1.78-.271.437-.663.755-1.175.953-.5.198-1.183.296-2.052.296-1.268 0-2.464-.077-3.59-.232l-.534-2.564c.527.07 1.09.134 1.688.19.613.057 1.225.092 1.838.106.441 0 .776-.042 1.004-.127.228-.099.406-.268.534-.508.129-.24.243-.615.342-1.123.128-.72.235-1.758.32-3.114.1-1.37.15-2.613.15-3.73 0-.465-.007-.797-.021-.995h-6.068c-.285 1.85-.72 3.482-1.304 4.894-.57 1.398-1.389 2.72-2.457 3.962-1.054 1.243-2.45 2.493-4.188 3.75l-1.86-2.076c1.51-1.031 2.729-2.062 3.655-3.093.94-1.032 1.666-2.133 2.18-3.306.526-1.186.925-2.563 1.196-4.13H24.2V6.83h3.654a45.065 45.065 0 00-1.432-1.59 27.662 27.662 0 00-1.282-1.334l1.902-1.59c.356.326.805.77 1.346 1.336a39.304 39.304 0 011.517 1.673l-1.73 1.505h2.585c.07-.763.135-1.597.192-2.5a54.38 54.38 0 00.128-1.97h2.692c0 .832-.1 2.323-.299 4.47H42zm-5.812 9.45c-.356-.523-.862-1.18-1.517-1.97a31.748 31.748 0 00-1.603-1.823l1.902-1.61c.442.438.976 1.017 1.603 1.737a22.648 22.648 0 011.602 1.95l-1.987 1.716z"
    })]
  }));
});
export default Icon;