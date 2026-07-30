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
      d: "M23.078 16.34c-.506 1.323-1.198 2.519-2.117 3.562-2.378 2.696-5.374 4.057-8.971 4.098a.037.037 0 01-.024-.01.041.041 0 01-.013-.023.041.041 0 01.003-.025.037.037 0 01.019-.019c1.886-.779 3.454-1.973 4.625-3.639a10.148 10.148 0 001.626-3.677c.217-.98.33-1.955.282-2.942-.048-1.018-.152-1.601-.484-2.565-.386-1.12-.915-2.16-1.627-3.089-.883-1.154-1.876-1.87-2.9-2.779-.995-.88-2.19-2.623-1.059-3.754.384-.384.997-.59 1.838-.621 2.478-.09 5.011 1.636 6.597 3.453.75.86 1.38 1.798 1.865 2.837.486 1.041.814 2.122.978 3.246.133.915.117 1.441.092 2.365a10.82 10.82 0 01-.73 3.582z",
      fill: a.fill
    }), /*#__PURE__*/_jsx("path", {
      d: "M11.86.01a.041.041 0 01.009.049.038.038 0 01-.018.018C9.964.856 8.396 2.05 7.225 3.716a10.148 10.148 0 00-1.626 3.678c-.217.979-.33 1.955-.283 2.941.049 1.018.154 1.601.486 2.565.385 1.12.914 2.16 1.626 3.088.883 1.154 1.876 1.872 2.9 2.78.995.88 2.19 2.622 1.059 3.753-.385.385-.997.591-1.838.622-2.478.089-5.011-1.636-6.597-3.454-.75-.86-1.38-1.797-1.865-2.837a11.591 11.591 0 01-.978-3.246c-.133-.914-.117-1.44-.091-2.364.034-1.225.284-2.416.73-3.582.504-1.323 1.197-2.52 2.116-3.562C5.241 1.402 8.238.04 11.835 0c.009 0 .018.004.024.01z",
      fill: b.fill
    }), /*#__PURE__*/_jsx("path", {
      d: "M8.721 11.903l2.455-.708.72-2.48a.066.066 0 01.127.002l.58 2.26c.776.437 1.65.755 2.622.956a.05.05 0 01.028.075.05.05 0 01-.024.019l-2.382.709a.163.163 0 00-.109.108l-.72 2.444a.034.034 0 01-.031.027.034.034 0 01-.034-.024l-.713-2.395a.183.183 0 00-.128-.128l-2.39-.705a.084.084 0 01-.044-.13.084.084 0 01.043-.03z",
      fill: c.fill
    }), /*#__PURE__*/_jsxs("defs", {
      children: [/*#__PURE__*/_jsxs("linearGradient", {
        gradientUnits: "userSpaceOnUse",
        id: a.id,
        x1: "17.889",
        x2: "17.889",
        y1: ".854",
        y2: "24",
        children: [/*#__PURE__*/_jsx("stop", {
          stopColor: "#F85EAD"
        }), /*#__PURE__*/_jsx("stop", {
          offset: "1",
          stopColor: "#FD75FD"
        })]
      }), /*#__PURE__*/_jsxs("linearGradient", {
        gradientUnits: "userSpaceOnUse",
        id: b.id,
        x1: "5.936",
        x2: "5.936",
        y1: "0",
        y2: "23.146",
        children: [/*#__PURE__*/_jsx("stop", {
          offset: ".332",
          stopColor: "#11F5EF"
        }), /*#__PURE__*/_jsx("stop", {
          offset: "1",
          stopColor: "#C738FB"
        })]
      }), /*#__PURE__*/_jsxs("linearGradient", {
        gradientUnits: "userSpaceOnUse",
        id: c.id,
        x1: "11.961",
        x2: "11.961",
        y1: "8.666",
        y2: "15.315",
        children: [/*#__PURE__*/_jsx("stop", {
          offset: ".332",
          stopColor: "#11F5EF"
        }), /*#__PURE__*/_jsx("stop", {
          offset: "1",
          stopColor: "#C738FB"
        })]
      })]
    })]
  }));
});
export default Icon;