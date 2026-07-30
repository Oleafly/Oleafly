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
    viewBox: "0 0 87 24",
    xmlns: "http://www.w3.org/2000/svg"
  }, rest), {}, {
    children: [/*#__PURE__*/_jsx("title", {
      children: TITLE
    }), /*#__PURE__*/_jsx("path", {
      d: "M17.122 16.607c0 4.696-3.219 7.393-7.774 7.393-3.674 0-6.255-1.546-7.257-4.637l3.401-1.21c.486 1.786 1.852 2.907 3.856 2.907 2.46 0 4.13-1.211 4.13-4.12v-1.122c-.85 1.121-2.46 2-4.494 2C4.61 17.818 2 14.273 2 9.909 2 5.546 4.611 2 8.984 2c2.004 0 3.644.879 4.494 2V2.303h3.644v14.303zm-3.583-6.85c0-2.908-1.58-4.575-3.857-4.575-2.52 0-4.008 1.757-4.008 4.727 0 2.94 1.488 4.727 4.008 4.727 2.278 0 3.857-1.666 3.857-4.515v-.363zM35.546 10.273c0 4.94-3.188 8.273-7.683 8.273-4.494 0-7.682-3.334-7.682-8.273C20.181 5.333 23.37 2 27.863 2c4.495 0 7.683 3.333 7.683 8.273zm-11.69 0c0 3.242 1.548 5.212 4.007 5.212 2.46 0 4.009-1.97 4.009-5.212 0-3.243-1.549-5.212-4.009-5.212-2.46 0-4.008 1.97-4.008 5.212zM52.957 10.273c0 4.94-3.188 8.273-7.682 8.273s-7.682-3.334-7.682-8.273C37.593 5.333 40.78 2 45.275 2s7.682 3.333 7.682 8.273zm-11.69 0c0 3.242 1.548 5.212 4.008 5.212s4.008-1.97 4.008-5.212c0-3.243-1.549-5.212-4.008-5.212-2.46 0-4.008 1.97-4.008 5.212zM54.336 15.182L57.069 13c.941 1.546 2.763 2.576 4.615 2.576 1.549 0 2.976-.546 2.976-1.97 0-1.364-1.336-1.515-3.856-2.03-2.52-.515-5.405-1.152-5.405-4.546 0-2.909 2.55-5.03 6.224-5.03 2.794 0 5.284 1.242 6.438 3L65.6 7.212c-.91-1.424-2.429-2.242-4.19-2.242-1.488 0-2.46.666-2.46 1.727 0 1.152 1.154 1.364 3.158 1.788 2.703.576 6.104 1.151 6.104 4.788 0 3.211-2.946 5.273-6.56 5.273-2.945 0-5.89-1.182-7.317-3.364zM77.965 18.546c-4.555 0-7.743-3.364-7.743-8.273 0-4.667 3.157-8.273 7.59-8.273 4.616 0 7.076 3.485 7.076 7.849v1.212H73.713c.274 2.727 1.913 4.394 4.252 4.394 1.791 0 3.218-.91 3.704-2.546l3.128 1.182c-1.124 2.787-3.644 4.455-6.832 4.455zm-.183-13.485c-1.882 0-3.34 1.12-3.886 3.272h7.318c-.03-1.757-1.124-3.272-3.432-3.272z"
    })]
  }));
});
export default Icon;