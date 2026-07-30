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
import { useFillId } from "../../hooks/useFillId";
import { TITLE } from "../style";
import { jsx as _jsx } from "react/jsx-runtime";
import { jsxs as _jsxs } from "react/jsx-runtime";
var Icon = /*#__PURE__*/memo(function (_ref) {
  var _ref$size = _ref.size,
    size = _ref$size === void 0 ? '1em' : _ref$size,
    style = _ref.style,
    rest = _objectWithoutProperties(_ref, _excluded);
  var _useFillId = useFillId(TITLE),
    id = _useFillId.id,
    fill = _useFillId.fill;
  return /*#__PURE__*/_jsxs("svg", _objectSpread(_objectSpread({
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
      d: "M20.607 2.247c-2.917-.966-5.426 1.084-6.011 2.96 0 0-2.105 6.76-3.002 9.58-.428 1.346-1.489 3.548-3.487 3.548-1.627 0-2.463-1.527-2.816-2.437L2.865 9.431c-.281-.681.013-2.04 1.14-2.447 1.204-.432 1.978.575 2.178 1.11l3.022 7.74c.72-.928 1.178-2.438 1.476-3.507l-1.984-5.21C7.756 4.686 5.267 3.58 2.962 4.43 1.095 5.118-.702 7.474.275 10.435l2.504 6.44c.38.976 1.881 4.163 5.275 4.163 4.073 0 5.601-3.473 6.449-6.218.424-1.373 2.749-8.797 2.749-8.797.338-1.109 1.71-1.428 2.568-1.148.605.196 1.698 1.031 1.345 2.325-.066.236-1.92 6.209-2.604 8.026-.357.948-1.262 3.006-3.324 2.72-.628 1.39-1.15 2.199-1.94 2.925 2.572 1.218 6.32-.009 7.898-4.776.586-1.773 2.644-8.166 2.644-8.166.598-1.963-.469-4.768-3.232-5.682z",
      fill: fill
    }), /*#__PURE__*/_jsx("defs", {
      children: /*#__PURE__*/_jsxs("linearGradient", {
        gradientUnits: "userSpaceOnUse",
        id: id,
        x1: ".759",
        x2: "26.155",
        y1: "5.637",
        y2: "17.311",
        children: [/*#__PURE__*/_jsx("stop", {
          stopColor: "#40EDD8"
        }), /*#__PURE__*/_jsx("stop", {
          offset: ".024",
          stopColor: "#38E7E2"
        }), /*#__PURE__*/_jsx("stop", {
          offset: ".084",
          stopColor: "#28DAF7"
        }), /*#__PURE__*/_jsx("stop", {
          offset: ".124",
          stopColor: "#22D5FF"
        }), /*#__PURE__*/_jsx("stop", {
          offset: ".36",
          stopColor: "#1ABFFF"
        }), /*#__PURE__*/_jsx("stop", {
          offset: ".85",
          stopColor: "#0786FE"
        }), /*#__PURE__*/_jsx("stop", {
          offset: ".909",
          stopColor: "#047FFE"
        })]
      })
    })]
  }));
});
export default Icon;