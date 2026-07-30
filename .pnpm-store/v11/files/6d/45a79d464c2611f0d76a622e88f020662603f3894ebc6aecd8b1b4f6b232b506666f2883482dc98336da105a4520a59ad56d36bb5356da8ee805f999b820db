'use client';

function _typeof(o) { "@babel/helpers - typeof"; return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function (o) { return typeof o; } : function (o) { return o && "function" == typeof Symbol && o.constructor === Symbol && o !== Symbol.prototype ? "symbol" : typeof o; }, _typeof(o); }
var _excluded = ["size", "style"];
function ownKeys(e, r) { var t = Object.keys(e); if (Object.getOwnPropertySymbols) { var o = Object.getOwnPropertySymbols(e); r && (o = o.filter(function (r) { return Object.getOwnPropertyDescriptor(e, r).enumerable; })), t.push.apply(t, o); } return t; }
function _objectSpread(e) { for (var r = 1; r < arguments.length; r++) { var t = null != arguments[r] ? arguments[r] : {}; r % 2 ? ownKeys(Object(t), !0).forEach(function (r) { _defineProperty(e, r, t[r]); }) : Object.getOwnPropertyDescriptors ? Object.defineProperties(e, Object.getOwnPropertyDescriptors(t)) : ownKeys(Object(t)).forEach(function (r) { Object.defineProperty(e, r, Object.getOwnPropertyDescriptor(t, r)); }); } return e; }
function _defineProperty(obj, key, value) { key = _toPropertyKey(key); if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { obj[key] = value; } return obj; }
function _toPropertyKey(t) { var i = _toPrimitive(t, "string"); return "symbol" == _typeof(i) ? i : String(i); }
function _toPrimitive(t, r) { if ("object" != _typeof(t) || !t) return t; var e = t[Symbol.toPrimitive]; if (void 0 !== e) { var i = e.call(t, r || "default"); if ("object" != _typeof(i)) return i; throw new TypeError("@@toPrimitive must return a primitive value."); } return ("string" === r ? String : Number)(t); }
function _slicedToArray(arr, i) { return _arrayWithHoles(arr) || _iterableToArrayLimit(arr, i) || _unsupportedIterableToArray(arr, i) || _nonIterableRest(); }
function _nonIterableRest() { throw new TypeError("Invalid attempt to destructure non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method."); }
function _unsupportedIterableToArray(o, minLen) { if (!o) return; if (typeof o === "string") return _arrayLikeToArray(o, minLen); var n = Object.prototype.toString.call(o).slice(8, -1); if (n === "Object" && o.constructor) n = o.constructor.name; if (n === "Map" || n === "Set") return Array.from(o); if (n === "Arguments" || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(n)) return _arrayLikeToArray(o, minLen); }
function _arrayLikeToArray(arr, len) { if (len == null || len > arr.length) len = arr.length; for (var i = 0, arr2 = new Array(len); i < len; i++) arr2[i] = arr[i]; return arr2; }
function _iterableToArrayLimit(r, l) { var t = null == r ? null : "undefined" != typeof Symbol && r[Symbol.iterator] || r["@@iterator"]; if (null != t) { var e, n, i, u, a = [], f = !0, o = !1; try { if (i = (t = t.call(r)).next, 0 === l) { if (Object(t) !== t) return; f = !1; } else for (; !(f = (e = i.call(t)).done) && (a.push(e.value), a.length !== l); f = !0); } catch (r) { o = !0, n = r; } finally { try { if (!f && null != t.return && (u = t.return(), Object(u) !== u)) return; } finally { if (o) throw n; } } return a; } }
function _arrayWithHoles(arr) { if (Array.isArray(arr)) return arr; }
function _objectWithoutProperties(source, excluded) { if (source == null) return {}; var target = _objectWithoutPropertiesLoose(source, excluded); var key, i; if (Object.getOwnPropertySymbols) { var sourceSymbolKeys = Object.getOwnPropertySymbols(source); for (i = 0; i < sourceSymbolKeys.length; i++) { key = sourceSymbolKeys[i]; if (excluded.indexOf(key) >= 0) continue; if (!Object.prototype.propertyIsEnumerable.call(source, key)) continue; target[key] = source[key]; } } return target; }
function _objectWithoutPropertiesLoose(source, excluded) { if (source == null) return {}; var target = {}; var sourceKeys = Object.keys(source); var key, i; for (i = 0; i < sourceKeys.length; i++) { key = sourceKeys[i]; if (excluded.indexOf(key) >= 0) continue; target[key] = source[key]; } return target; }
import { memo } from 'react';
import { useFillIds } from "../../hooks/useFillId";
import { TITLE } from "../style";
import { jsx as _jsx } from "react/jsx-runtime";
import { jsxs as _jsxs } from "react/jsx-runtime";
var Icon = /*#__PURE__*/memo(function (_ref) {
  var _ref$size = _ref.size,
    size = _ref$size === void 0 ? '1em' : _ref$size,
    style = _ref.style,
    rest = _objectWithoutProperties(_ref, _excluded);
  var _useFillIds = useFillIds(TITLE, 4),
    _useFillIds2 = _slicedToArray(_useFillIds, 4),
    a = _useFillIds2[0],
    b = _useFillIds2[1],
    c = _useFillIds2[2],
    d = _useFillIds2[3];
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
    }), /*#__PURE__*/_jsxs("g", {
      opacity: ".45",
      children: [/*#__PURE__*/_jsx("path", {
        d: "M3.474 24l3.943-8.21H9.34L3.474 24z",
        fill: a.fill
      }), /*#__PURE__*/_jsx("path", {
        d: "M24 24h-4.895l-3.882-8.362 1.356-3.164H9.01L15 0l9 24z",
        fill: b.fill
      })]
    }), /*#__PURE__*/_jsx("path", {
      d: "M15.743 12.474H7.737l-1.263 3.315L0 24 10.737 0l5.006 12.474z",
      fill: c.fill
    }), /*#__PURE__*/_jsx("path", {
      d: "M16.146 13.48L20.369 24h-5.21l-3.473-8.21h3.473l.989-2.31z",
      fill: d.fill
    }), /*#__PURE__*/_jsxs("defs", {
      children: [/*#__PURE__*/_jsxs("linearGradient", {
        gradientUnits: "userSpaceOnUse",
        id: a.id,
        x1: "12",
        x2: "12",
        y1: "0",
        y2: "24",
        children: [/*#__PURE__*/_jsx("stop", {
          stopColor: "#14B8A6"
        }), /*#__PURE__*/_jsx("stop", {
          offset: ".5",
          stopColor: "#0D7D72"
        }), /*#__PURE__*/_jsx("stop", {
          offset: "1",
          stopColor: "#044F47"
        })]
      }), /*#__PURE__*/_jsxs("linearGradient", {
        gradientUnits: "userSpaceOnUse",
        id: b.id,
        x1: "12",
        x2: "12",
        y1: "0",
        y2: "24",
        children: [/*#__PURE__*/_jsx("stop", {
          stopColor: "#14B8A6"
        }), /*#__PURE__*/_jsx("stop", {
          offset: ".5",
          stopColor: "#0D7D72"
        }), /*#__PURE__*/_jsx("stop", {
          offset: "1",
          stopColor: "#044F47"
        })]
      }), /*#__PURE__*/_jsxs("linearGradient", {
        gradientUnits: "userSpaceOnUse",
        id: c.id,
        x1: "0",
        x2: "0",
        y1: "0",
        y2: "24",
        children: [/*#__PURE__*/_jsx("stop", {
          stopColor: "#5EEAD4"
        }), /*#__PURE__*/_jsx("stop", {
          offset: ".25",
          stopColor: "#2DD4BF"
        }), /*#__PURE__*/_jsx("stop", {
          offset: ".65",
          stopColor: "#0D9488"
        }), /*#__PURE__*/_jsx("stop", {
          offset: "1",
          stopColor: "#0A7A6F"
        })]
      }), /*#__PURE__*/_jsxs("linearGradient", {
        gradientUnits: "userSpaceOnUse",
        id: d.id,
        x1: "0",
        x2: "0",
        y1: "0",
        y2: "24",
        children: [/*#__PURE__*/_jsx("stop", {
          stopColor: "#5EEAD4"
        }), /*#__PURE__*/_jsx("stop", {
          offset: ".25",
          stopColor: "#2DD4BF"
        }), /*#__PURE__*/_jsx("stop", {
          offset: ".65",
          stopColor: "#0D9488"
        }), /*#__PURE__*/_jsx("stop", {
          offset: "1",
          stopColor: "#0A7A6F"
        })]
      })]
    })]
  }));
});
export default Icon;