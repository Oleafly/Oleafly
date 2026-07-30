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
  var _useFillIds = useFillIds(TITLE, 2),
    _useFillIds2 = _slicedToArray(_useFillIds, 2),
    a = _useFillIds2[0],
    b = _useFillIds2[1];
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
      d: "M11.853 15.257c-.318.069-.648.101-.99.101H7.933a7.89 7.89 0 01-4.072-1.132 8.15 8.15 0 01-.616-.406 8.033 8.033 0 01-2.541-3.154c-.1-.23-.19-.46-.274-.7a8.007 8.007 0 01-.407-2.522V1H3.27v6.444c0 .153.004.298.025.443.016.214.048.415.1.616a4.681 4.681 0 002.223 2.985 4.667 4.667 0 002.296.616h.024a4.043 4.043 0 013.919 3.153h-.004z",
      fill: a.fill
    }), /*#__PURE__*/_jsx("path", {
      d: "M3.246 14.557v8.039H0v-12.24c.105.39.274.834.362 1.007a8.474 8.474 0 002.884 3.198v-.004z",
      fill: "#1E8CFE"
    }), /*#__PURE__*/_jsx("path", {
      d: "M15.824 16.151v6.445h-3.246V16.15a3.26 3.26 0 00-.024-.447 4.683 4.683 0 00-2.32-3.6 4.706 4.706 0 00-2.3-.616H7.91a4.047 4.047 0 01-3.919-3.146c.318-.068.649-.1.991-.1H7.91a7.89 7.89 0 014.072 1.131c.213.125.419.262.616.407a7.959 7.959 0 012.537 3.154 7.849 7.849 0 01.689 3.218z",
      fill: b.fill
    }), /*#__PURE__*/_jsx("path", {
      d: "M19.904 3.868c0-.552.201-1.027.6-1.426.399-.403.882-.6 1.442-.6.56 0 1.055.201 1.454.6.403.39.6.874.6 1.442s-.201 1.055-.6 1.454c-.39.402-.87.6-1.442.6a1.979 1.979 0 01-1.454-.6c-.403-.403-.6-.89-.6-1.47zm3.73 5.107v13.62h-3.36V8.972h3.36v.004z",
      fill: "#0418FF"
    }), /*#__PURE__*/_jsx("path", {
      d: "M12.578 9.039V1h3.246v12.24a6.393 6.393 0 00-.362-1.007 8.474 8.474 0 00-2.884-3.198v.004z",
      fill: "#1E8CFE"
    }), /*#__PURE__*/_jsxs("defs", {
      children: [/*#__PURE__*/_jsxs("linearGradient", {
        gradientUnits: "userSpaceOnUse",
        id: a.id,
        x1: ".024",
        x2: "11.853",
        y1: "8.177",
        y2: "8.177",
        children: [/*#__PURE__*/_jsx("stop", {
          stopColor: "#0418FF"
        }), /*#__PURE__*/_jsx("stop", {
          offset: "1",
          stopColor: "#1E8CFE"
        })]
      }), /*#__PURE__*/_jsxs("linearGradient", {
        gradientUnits: "userSpaceOnUse",
        id: b.id,
        x1: "15.824",
        x2: "3.991",
        y1: "15.418",
        y2: "15.418",
        children: [/*#__PURE__*/_jsx("stop", {
          stopColor: "#0418FF"
        }), /*#__PURE__*/_jsx("stop", {
          offset: "1",
          stopColor: "#1E8CFE"
        })]
      })]
    })]
  }));
});
export default Icon;