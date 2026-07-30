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
    }), /*#__PURE__*/_jsx("g", {
      transform: "scale(0.15)",
      children: /*#__PURE__*/_jsx("path", {
        clipRule: "evenodd",
        d: "M76.5655 12.5465C83.6841 12.273 98.0909 13.2144 109.616 23.5631C119.071 32.0522 122.328 47.7904 120.125 59.9938C118.105 71.1802 113.346 80.3327 115.21 88.8073C117.074 97.2819 121.818 101.46 125.854 103.215C129.752 104.909 133.52 104.401 132.803 107.621C132.085 110.841 127.21 112.028 123.65 112.028C121.698 112.028 115.795 111.519 113.176 109.824C110.081 107.821 109.391 106.026 108.213 104.583C108.013 104.338 107.66 104.509 107.707 104.821C108.244 108.371 109.724 114.394 112.125 118.13C114.068 121.152 114.871 123.356 119.322 127.085C123.774 130.813 125.853 134.203 121.525 136.604C117.68 138.736 109.322 134.373 104.407 128.977C99.9829 124.12 96.9028 118.129 95.6846 114.231C95.0335 112.147 94.3811 108.562 93.7296 105.63C93.644 105.244 93.116 105.306 93.1046 105.701C92.8883 113.164 91.7152 120.291 90.0001 127.932C88.7652 133.433 85.7626 140.135 83.0508 144.203C79.7442 149.163 74.8354 150.711 71.1866 149.355C68.2684 148.27 70.3392 144.582 71.1866 141.389C72.034 138.197 73.7294 131.519 74.8712 124.203C75.9046 117.581 76.1781 111.026 75.7178 104.815C75.6893 104.436 75.1073 104.378 74.9893 104.739C74.0382 107.652 72.2455 112.481 70.9376 115.418C68.2097 121.543 66.1909 124.231 60.5977 130.672C55.5676 136.464 41.1004 144.655 39.2422 136.604C38.7338 134.401 41.3978 133.436 43.8546 131.519C47.5476 128.638 50.6336 123.525 53.5596 117.282C56.1869 111.676 57.5223 106.253 57.7266 102.791C57.746 102.457 57.3268 102.331 57.1387 102.607C55.9225 104.391 54.1317 106.805 52.1592 108.807C48.8643 112.152 45.2098 115.595 40.9717 117.282C34.1576 119.994 27.2089 118.129 27.7169 113.215C28.1415 109.109 32.725 109.959 38.4307 103.734C44.0239 97.6323 45.8876 92.8857 46.2266 87.6315C46.4975 83.428 42.3854 73.4513 40.295 68.9879C36.9616 61.8693 34.4984 41.666 44.5323 28.6491C57.0743 12.3784 72.1582 12.7159 76.5655 12.5465ZM57.0001 40.9997C52.3335 40.9997 50.0002 44.5815 50.0001 48.9997C50.0001 53.4179 52.5927 56.9997 57.0001 56.9997C61.4074 56.9996 64.0001 53.4179 64.0001 48.9997C63.9999 44.5816 61.6666 40.9997 57.0001 40.9997ZM95.0001 40.9997C90.3335 40.9997 88.0002 44.5815 88.0001 48.9997C88.0001 53.4179 90.5927 56.9997 95.0001 56.9997C99.4074 56.9996 102 53.4179 102 48.9997C102 44.5816 99.6666 40.9997 95.0001 40.9997Z",
        fillRule: "evenodd"
      })
    })]
  }));
});
export default Icon;