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
    fill = _useFillId.fill,
    id = _useFillId.id;
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
      d: "M24 12C24 5.373 18.6-.017 11.97 0 5.39.017.015 5.39 0 11.97-.017 18.6 5.373 24 12 24h7.885a4.108 4.108 0 004.108-4.108V12.4c.004-.133.007-.266.007-.4zM5.829 18.664c-1.91-1.63-3.088-4.24-3.033-6.9.004-.186.013-.372.03-.558v-.012c.277-3.174 2.327-6.134 5.2-7.509 2.874-1.375 6.466-1.112 9.11.664 2.644 1.777 4.243 5.004 4.056 8.184a11.38 11.38 0 01-.329 2.063c-.066.27-.147.549-.338.75-.19.201-.524.295-.75.134-.216-.154-.248-.456-.266-.72-.15-2.134-.72-4.335-2.162-5.915A6.636 6.636 0 0013.1 6.743a6.858 6.858 0 00-4.577 1.252c-1.099.787-1.962 1.914-2.38 3.2-.416 1.285-.374 2.726.175 3.962a5.24 5.24 0 001.9 2.24c1.467.963 3.475 1.1 5 .23 1.524-.87 2.435-2.758 2.047-4.47-.389-1.712-2.124-3.047-3.87-2.866-.266.027-.648-.002-.657-.27-.008-.207.241-.316.445-.353 1.771-.318 3.67.582 4.64 2.097.973 1.515 1.022 3.544.229 5.16-.794 1.615-2.37 2.795-4.118 3.221-2.357.575-4.491-.105-6.103-1.482h-.002z",
      fill: fill
    }), /*#__PURE__*/_jsx("defs", {
      children: /*#__PURE__*/_jsxs("linearGradient", {
        gradientUnits: "userSpaceOnUse",
        id: id,
        x1: ".539",
        x2: "27.487",
        y1: ".884",
        y2: "27.022",
        children: [/*#__PURE__*/_jsx("stop", {
          offset: ".09",
          stopColor: "#FFAB0C"
        }), /*#__PURE__*/_jsx("stop", {
          offset: ".31",
          stopColor: "#FF5538"
        }), /*#__PURE__*/_jsx("stop", {
          offset: ".46",
          stopColor: "#E9405D"
        }), /*#__PURE__*/_jsx("stop", {
          offset: ".75",
          stopColor: "#D266DA"
        }), /*#__PURE__*/_jsx("stop", {
          offset: ".89",
          stopColor: "#D584EF"
        })]
      })
    })]
  }));
});
export default Icon;