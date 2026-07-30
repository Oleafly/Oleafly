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
    viewBox: "0 0 119 24",
    xmlns: "http://www.w3.org/2000/svg"
  }, rest), {}, {
    children: [/*#__PURE__*/_jsx("title", {
      children: TITLE
    }), /*#__PURE__*/_jsx("path", {
      d: "M14.436 7.573l-.028 14.297c0 .068-.051.125-.108.125l-3.989-.012c-.062 0-.107-.056-.107-.123l.04-14.293M2.107 5.56C2.045 5.56 2 5.501 2 5.433l.011-3.31c0-.067.051-.124.108-.124l20.44.051c.063 0 .108.057.108.125v3.31c0 .067-.05.123-.107.123M31.986 10.922v10.96c.005.056-.04.107-.09.107h-3.927c-.062 0-.113-.062-.113-.13V2.036c5.182 0 10.376 0 15.575.006 1.816 0 3.78.667 3.898 3.088.046.911.051 2.4.023 4.47-.017 1.222-.034 1.896-.05 2.014-.487 3.32-4.012 2.891-6.157 2.812-.18-.005-.203.05-.062.182l7.966 7.196c.147.135.125.197-.062.197l-5.584-.017a.447.447 0 01-.323-.141l-9.968-10.585c-.108-.12-.034-.323.118-.323l8.645.09c.974-.005 1.454-.514 1.454-1.52V7.11c.006-1.064-.47-1.602-1.43-1.608-3.39-.016-6.66-.022-9.806-.01-.056 0-.102.05-.102.113v5.317M55.98 2.035h4.012c.05 0 .09.045.09.102v19.745c0 .056-.04.101-.09.101H55.98c-.05 0-.09-.045-.09-.1V2.136c0-.057.04-.102.09-.102zM83.403 10.793c.345 0 1.358-.696 1.358-1.403V6.917c0-.775-.6-1.409-1.347-1.415L73.7 5.463c-.09 0-.159.08-.164.175l-.113 16.142c0 .13-.057.197-.176.197h-3.802c-.09 0-.158-.084-.158-.18V2.164c0-.095.045-.146.13-.146 4.634.017 9.635.01 15.004-.012 2.399-.01 4.424.64 4.374 3.78-.023 1.465-.017 2.863.01 4.192.035 1.453-.242 2.432-.78 3.077-.764.923-1.827 1.15-3.66 1.15-6.354 0-7.435-.023-7.435-.023v-3.355s4.164-.04 6.456-.04l.017.005zM117.105 18.42c0 1.945-1.414 3.529-3.162 3.529l-15.842.028c-1.748 0-3.174-1.572-3.174-3.518l-.023-12.877c0-1.946 1.415-3.53 3.163-3.53l15.842-.03c1.748 0 3.174 1.573 3.174 3.52l.022 12.877zm-4.158-12.714c0-.062-.046-.113-.102-.113H99.199c-.057 0-.102.05-.102.113v12.402c0 .061.045.113.102.113h13.646c.056 0 .102-.052.102-.113V5.706z"
    })]
  }));
});
export default Icon;