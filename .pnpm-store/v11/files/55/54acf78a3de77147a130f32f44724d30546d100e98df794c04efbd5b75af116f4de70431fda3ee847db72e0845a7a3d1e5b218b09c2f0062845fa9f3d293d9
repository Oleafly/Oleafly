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
      d: "M23.314 7.947c.206.504.491 1.709.602 2.538.134 1 .06 3-.143 3.938a12.13 12.13 0 01-3.278 6.053c-1.635 1.645-3.678 2.762-6.027 3.294-.712.16-3.534.264-4.062.149-.878-.192-1.255-.82-.897-1.494.074-.139 1.31-1.425 2.746-2.858l2.611-2.603.793-.025c.53-.017.895-.08 1.097-.187.423-.225.895-.718 1.104-1.152.2-.415.292-1.377.163-1.716-.078-.21-.025-.266.725-.768 1.657-1.108 3.122-2.773 4.002-4.545l.45-.905.114.281z",
      fill: a.fill
    }), /*#__PURE__*/_jsx("path", {
      d: "M.833 7.787c.031.004.239.382.459.84.748 1.554 2.214 3.267 3.682 4.303 2.034 1.437 4.303 2.194 6.964 2.322l1.203.06-2.937 2.939c-3.255 3.258-3.448 3.407-4.433 3.403-.362-.002-.716-.07-.978-.188-.505-.23-1.726-1.402-2.422-2.326-.955-1.267-1.74-3.002-2.15-4.75-.266-1.143-.243-3.813.044-4.968.23-.928.478-1.642.568-1.635z",
      fill: b.fill
    }), /*#__PURE__*/_jsx("path", {
      clipRule: "evenodd",
      d: "M11.484.028c2.054-.088 2.932.167 3.08.895.1.501-.269.957-2.883 3.57L9.105 7.064l-.731.01c-.555.008-.824.058-1.108.21-1.114.593-1.62 1.858-1.216 3.041.328.964 1.3 1.636 2.34 1.62.215-.005.476-.039.678-.087l-.023.009.089-.03c.924-.268 1.66-1.31 1.665-2.357.002-.344.063-.625.176-.808.095-.156 1.45-1.556 3.012-3.113 3.134-3.122 3.251-3.21 4.287-3.213.823-.003 1.257.225 2.194 1.16a11.968 11.968 0 012.73 4.162l-.447.903c-.88 1.772-2.347 3.437-4.003 4.545-.75.502-.803.559-.725.768.044.114.063.299.06.51a2.444 2.444 0 00-.629-1.478c-1.163-1.287-3.25-1.005-4.008.542-.2.41-.248.64-.244 1.151l.007.639-.067.063-1.204-.06c-1.644-.079-3.139-.398-4.521-.97h-.001a12.485 12.485 0 01-2.442-1.351C3.6 11.96 2.23 10.4 1.446 8.931l-.154-.305c-.22-.459-.428-.836-.459-.84-.032-.003-.082.084-.145.237.015-.062.035-.128.06-.196 1.04-2.842 3.136-5.177 5.88-6.553C8.253.461 9.62.11 11.484.028z",
      fill: c.fill,
      fillRule: "evenodd"
    }), /*#__PURE__*/_jsxs("defs", {
      children: [/*#__PURE__*/_jsxs("linearGradient", {
        gradientUnits: "userSpaceOnUse",
        id: a.id,
        x1: "0",
        x2: "24",
        y1: "14.5",
        y2: "14.5",
        children: [/*#__PURE__*/_jsx("stop", {
          stopColor: "#E560FC"
        }), /*#__PURE__*/_jsx("stop", {
          offset: "1",
          stopColor: "#673CFF"
        })]
      }), /*#__PURE__*/_jsxs("linearGradient", {
        gradientUnits: "userSpaceOnUse",
        id: b.id,
        x1: "0",
        x2: "24",
        y1: "14.5",
        y2: "14.5",
        children: [/*#__PURE__*/_jsx("stop", {
          stopColor: "#E560FC"
        }), /*#__PURE__*/_jsx("stop", {
          offset: "1",
          stopColor: "#673CFF"
        })]
      }), /*#__PURE__*/_jsxs("linearGradient", {
        gradientUnits: "userSpaceOnUse",
        id: c.id,
        x1: ".5",
        x2: "23",
        y1: "8",
        y2: "7.5",
        children: [/*#__PURE__*/_jsx("stop", {
          stopColor: "#0ED1FC"
        }), /*#__PURE__*/_jsx("stop", {
          offset: "1",
          stopColor: "#3171F5"
        })]
      })]
    })]
  }));
});
export default Icon;