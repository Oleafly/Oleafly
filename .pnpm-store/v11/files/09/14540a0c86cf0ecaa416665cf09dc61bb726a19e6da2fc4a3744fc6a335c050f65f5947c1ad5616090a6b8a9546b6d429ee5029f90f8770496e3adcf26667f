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
      d: "M14.74 9.977l-1.584 1.583h3.563v.942h-3.563l1.583 1.583-.666.666-2.053-2.054-2.054 2.054-.666-.666 1.583-1.583H7.32v-.942h3.562L9.299 9.977l.666-.666 2.055 2.054 2.054-2.054.666.666z"
    }), /*#__PURE__*/_jsx("path", {
      clipRule: "evenodd",
      d: "M11.99.083c6.575 0 11.905 5.332 11.905 11.907 0 3.198-1.263 6.099-3.315 8.237a5.727 5.727 0 01-.353.353 11.862 11.862 0 01-8.237 3.316C5.415 23.895.084 18.566.084 11.99c0-3.188 1.255-6.081 3.296-8.219a5.75 5.75 0 01.393-.394A11.864 11.864 0 0111.99.083zM1.93 16.354c1.687 3.884 5.556 6.6 10.06 6.6 1.42 0 2.776-.274 4.022-.765a9.709 9.709 0 01-2.23-.186c-1.665-.328-3.396-1.069-5.036-2.18-1.946-.374-3.695-1.074-5.104-2.02a9.703 9.703 0 01-1.712-1.448zm19.154.899a10.46 10.46 0 01-.746.55c-2.157 1.447-5.11 2.327-8.349 2.327-.296 0-.59-.011-.88-.025.96.463 1.922.791 2.854.975 2.345.462 4.427.015 5.78-1.338.669-.67 1.116-1.518 1.341-2.49zM11.989 4.79c-3.077 0-5.841.838-7.823 2.167a8.863 8.863 0 00-1.44 1.195 8.86 8.86 0 00.172 1.864c.462 2.34 1.826 4.888 4.001 7.064.705.705 1.45 1.323 2.213 1.855.916.164 1.88.254 2.877.254 3.077 0 5.843-.838 7.825-2.168a8.858 8.858 0 001.438-1.194 8.865 8.865 0 00-.172-1.864c-.461-2.341-1.824-4.888-4-7.064a16.323 16.323 0 00-2.213-1.855 16.32 16.32 0 00-2.878-.254zM1.836 9.278c-.528.846-.81 1.764-.81 2.711 0 1.913 1.155 3.701 3.14 5.032.788.53 1.701.978 2.708 1.33a17.78 17.78 0 01-.64-.606c-2.29-2.29-3.756-5-4.258-7.548a10.48 10.48 0 01-.14-.919zm15.27-3.65c.216.195.43.396.64.605 2.29 2.29 3.756 5 4.258 7.548.06.308.106.614.139.917.527-.845.811-1.762.811-2.709 0-1.913-1.156-3.7-3.14-5.032-.789-.529-1.701-.978-2.708-1.33zM11.99 1.025c-1.42 0-2.777.272-4.022.764a9.707 9.707 0 012.23.186c1.665.328 3.398 1.07 5.038 2.181 1.945.374 3.694 1.075 5.102 2.02a9.704 9.704 0 011.71 1.448A10.965 10.965 0 0011.99 1.025zm-1.974 1.873c-2.345-.462-4.427-.014-5.78 1.338-.67.67-1.117 1.519-1.342 2.49.237-.192.487-.375.748-.55C5.798 4.729 8.75 3.85 11.989 3.85c.296 0 .589.009.88.023a11.917 11.917 0 00-2.853-.975z"
    })]
  }));
});
export default Icon;