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
  var _useFillIds = useFillIds(TITLE, 3),
    _useFillIds2 = _slicedToArray(_useFillIds, 3),
    a = _useFillIds2[0],
    b = _useFillIds2[1],
    c = _useFillIds2[2];
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
      d: "M4.707 6.24V3.5H0v16.977h4.707v-2.74H2.94V6.24h1.766z"
    }), /*#__PURE__*/_jsx("path", {
      d: "M20.868 3.5h-1.575v2.74h1.775v11.497h-1.775v2.74H24V3.5h-3.132zM13.22 3.5l-.55 3.082H9.623l.541-3.082h3.057zM14.395 8.398l-2.133 12.08H9.213l2.125-12.08h3.057z",
      fill: "#32EDDA"
    }), /*#__PURE__*/_jsx("path", {
      d: "M14.395 8.398l-2.133 12.08h7.031v-2.741h1.775V8.398h-6.673z",
      fill: a.fill
    }), /*#__PURE__*/_jsx("path", {
      d: "M9.622 6.583l1.716 1.816h3.057l-1.724-1.816H9.62z",
      fill: b.fill
    }), /*#__PURE__*/_jsx("path", {
      d: "M13.22 3.5h6.073v2.74h1.775v2.158h-6.673L12.67 6.582l.55-3.082z",
      fill: c.fill
    }), /*#__PURE__*/_jsxs("defs", {
      children: [/*#__PURE__*/_jsxs("linearGradient", {
        gradientUnits: "userSpaceOnUse",
        id: a.id,
        x1: "10.505",
        x2: "20.36",
        y1: "13.772",
        y2: "14.838",
        children: [/*#__PURE__*/_jsx("stop", {
          stopColor: "#32EDDA"
        }), /*#__PURE__*/_jsx("stop", {
          offset: ".09",
          stopColor: "#48EEDD",
          stopOpacity: ".89"
        }), /*#__PURE__*/_jsx("stop", {
          offset: ".43",
          stopColor: "#95F5EB",
          stopOpacity: ".51"
        }), /*#__PURE__*/_jsx("stop", {
          offset: ".7",
          stopColor: "#CEFAF6",
          stopOpacity: ".24"
        }), /*#__PURE__*/_jsx("stop", {
          offset: ".9",
          stopColor: "#F1FDFC",
          stopOpacity: ".07"
        }), /*#__PURE__*/_jsx("stop", {
          offset: "1",
          stopColor: "#fff",
          stopOpacity: "0"
        })]
      }), /*#__PURE__*/_jsxs("linearGradient", {
        gradientUnits: "userSpaceOnUse",
        id: b.id,
        x1: "11.854",
        x2: "12.321",
        y1: "6.258",
        y2: "9.998",
        children: [/*#__PURE__*/_jsx("stop", {
          offset: ".01",
          stopColor: "#32EDDA"
        }), /*#__PURE__*/_jsx("stop", {
          offset: ".06",
          stopColor: "#4CEFDE",
          stopOpacity: ".87"
        }), /*#__PURE__*/_jsx("stop", {
          offset: ".15",
          stopColor: "#76F2E6",
          stopOpacity: ".67"
        }), /*#__PURE__*/_jsx("stop", {
          offset: ".25",
          stopColor: "#9AF6EC",
          stopOpacity: ".49"
        }), /*#__PURE__*/_jsx("stop", {
          offset: ".35",
          stopColor: "#B9F8F2",
          stopOpacity: ".34"
        }), /*#__PURE__*/_jsx("stop", {
          offset: ".45",
          stopColor: "#D3FBF7",
          stopOpacity: ".21"
        }), /*#__PURE__*/_jsx("stop", {
          offset: ".56",
          stopColor: "#E6FCFA",
          stopOpacity: ".12"
        }), /*#__PURE__*/_jsx("stop", {
          offset: ".68",
          stopColor: "#F4FEFD",
          stopOpacity: ".05"
        }), /*#__PURE__*/_jsx("stop", {
          offset: ".82",
          stopColor: "#FCFEFE",
          stopOpacity: ".01"
        }), /*#__PURE__*/_jsx("stop", {
          offset: "1",
          stopColor: "#fff",
          stopOpacity: "0"
        })]
      }), /*#__PURE__*/_jsxs("linearGradient", {
        gradientUnits: "userSpaceOnUse",
        id: c.id,
        x1: "13.112",
        x2: "20.41",
        y1: "2.9",
        y2: "8.873",
        children: [/*#__PURE__*/_jsx("stop", {
          stopColor: "#32EDDA"
        }), /*#__PURE__*/_jsx("stop", {
          offset: ".1",
          stopColor: "#5BF0E1",
          stopOpacity: ".8"
        }), /*#__PURE__*/_jsx("stop", {
          offset: ".23",
          stopColor: "#86F4E9",
          stopOpacity: ".59"
        }), /*#__PURE__*/_jsx("stop", {
          offset: ".35",
          stopColor: "#ABF7EF",
          stopOpacity: ".41"
        }), /*#__PURE__*/_jsx("stop", {
          offset: ".48",
          stopColor: "#C9FAF5",
          stopOpacity: ".26"
        }), /*#__PURE__*/_jsx("stop", {
          offset: ".6",
          stopColor: "#E1FCF9",
          stopOpacity: ".15"
        }), /*#__PURE__*/_jsx("stop", {
          offset: ".73",
          stopColor: "#F1FDFC",
          stopOpacity: ".06"
        }), /*#__PURE__*/_jsx("stop", {
          offset: ".86",
          stopColor: "#FBFEFE",
          stopOpacity: ".02"
        }), /*#__PURE__*/_jsx("stop", {
          offset: "1",
          stopColor: "#fff",
          stopOpacity: "0"
        })]
      })]
    })]
  }));
});
export default Icon;