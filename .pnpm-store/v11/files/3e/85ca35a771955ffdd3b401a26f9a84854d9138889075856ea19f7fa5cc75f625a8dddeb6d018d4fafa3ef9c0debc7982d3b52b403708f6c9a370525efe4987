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
    viewBox: "0 0 107 24",
    xmlns: "http://www.w3.org/2000/svg"
  }, rest), {}, {
    children: [/*#__PURE__*/_jsx("title", {
      children: TITLE
    }), /*#__PURE__*/_jsx("path", {
      d: "M104.859 2v19.712h-3.571V2h3.571zM84.388 21.712V2h7.391c1.515 0 2.785.282 3.812.847 1.033.565 1.813 1.341 2.339 2.33.532.981.799 2.098.799 3.349 0 1.264-.266 2.387-.8 3.369-.532.981-1.318 1.755-2.357 2.32-1.04.558-2.32.837-3.84.837h-4.9v-2.936h4.418c.886 0 1.61-.154 2.175-.462a2.915 2.915 0 001.252-1.27c.276-.54.413-1.159.413-1.858 0-.7-.137-1.316-.413-1.848-.27-.533-.69-.947-1.261-1.242-.565-.301-1.293-.452-2.185-.452h-3.273v16.728h-3.57zM67.847 21.712h-3.812L70.975 2h4.408l6.95 19.712H78.52l-5.265-15.67h-.154l-5.255 15.67zm.125-7.729h10.395v2.869H67.972v-2.869zM39.89 21.712L35.713 6.928h3.551l2.6 10.395h.134l2.656-10.395h3.513l2.657 10.337h.144l2.56-10.337h3.562l-4.187 14.784h-3.629l-2.772-9.991H46.3l-2.772 9.99H39.89zM27.94 22c-1.483 0-2.763-.308-3.841-.924-1.072-.622-1.896-1.501-2.474-2.637-.578-1.142-.866-2.486-.866-4.033 0-1.52.288-2.855.866-4.004.584-1.155 1.399-2.053 2.445-2.695 1.046-.648 2.274-.972 3.686-.972.911 0 1.771.147 2.58.443a5.83 5.83 0 012.156 1.347c.629.61 1.123 1.386 1.482 2.33.36.936.539 2.053.539 3.349v1.068H22.395v-2.348h8.778c-.006-.668-.15-1.261-.433-1.78a3.15 3.15 0 00-1.184-1.242c-.5-.302-1.084-.453-1.752-.453-.712 0-1.337.173-1.877.52-.539.34-.959.79-1.26 1.347a3.877 3.877 0 00-.453 1.82v2.05c0 .86.157 1.597.472 2.213.314.61.754 1.078 1.319 1.406.564.32 1.225.481 1.982.481.507 0 .966-.07 1.377-.212.41-.147.766-.362 1.068-.645.302-.282.53-.632.683-1.049l3.254.366a5.071 5.071 0 01-1.175 2.252c-.57.636-1.302 1.13-2.194 1.482-.892.347-1.912.52-3.06.52zM18.199 2v19.712h-3.176L5.735 8.285H5.57v13.427H2V2h3.196l9.278 13.437h.173V2H18.2z"
    })]
  }));
});
export default Icon;