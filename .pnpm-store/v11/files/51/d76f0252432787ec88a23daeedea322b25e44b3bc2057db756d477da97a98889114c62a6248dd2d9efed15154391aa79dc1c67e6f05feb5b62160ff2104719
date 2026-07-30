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
  var _useFillIds = useFillIds(TITLE, 5),
    _useFillIds2 = _slicedToArray(_useFillIds, 5),
    a = _useFillIds2[0],
    b = _useFillIds2[1],
    c = _useFillIds2[2],
    d = _useFillIds2[3],
    e = _useFillIds2[4];
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
      clipRule: "evenodd",
      d: "M12 0h.018c1.473-.002 2.88.261 4.179.754C20.755 2.456 24 6.85 24 12c0 6.627-5.373 12-12 12S0 18.627 0 12 5.373 0 12 0zm8.604 18.967A11.024 11.024 0 0023.07 12c0-1.717-.39-3.344-1.089-4.794a2.59 2.59 0 01-3.214.62 6.278 6.278 0 01-1.333-.992C16.283 5.73 15.109 4.66 13.696 3.9c-3.211-1.729-6.825-1.501-9.695.447A11.033 11.033 0 00.93 12c0 1.663.367 3.241 1.024 4.657.75-.973 2.131-1.346 3.232-.71.667.384 1.257.92 1.837 1.447l.176.16c1.365 1.234 2.794 2.355 4.558 2.965 3.053 1.053 6.356.437 8.847-1.552z",
      fill: a.fill,
      fillRule: "evenodd"
    }), /*#__PURE__*/_jsx("path", {
      d: "M5.643 10.312c-.83.11-1.401.766-1.408 1.618a1.715 1.715 0 001.45 1.72c.805.128 1.64-.426 1.87-1.26.046-.167.076-.338.106-.51.025-.14.05-.282.084-.42.318-1.317 1.237-1.95 2.788-1.93 1.086.013 1.318.271 1.68 1.855.017.076.043.151.07.226.26.714.976 1.17 1.67 1.065a1.647 1.647 0 001.38-1.438c.083-.729-.348-1.264-1.122-1.575-.34-.136-.664-.158-.995-.141-.726.037-1.121-.36-1.339-.977a3.359 3.359 0 01-.134-.65c-.014-.093-.027-.186-.043-.278-.156-.887-.835-1.51-1.669-1.532-.791-.02-1.464.551-1.665 1.418l-.06.27-.025.117c-.355 1.636-.974 2.205-2.638 2.422z",
      fill: b.fill
    }), /*#__PURE__*/_jsx("path", {
      d: "M18.059 13.644c.989-.206 1.577-.838 1.592-1.697.015-.83-.624-1.582-1.46-1.724-.77-.13-1.599.383-1.844 1.18-.069.22-.117.448-.165.676-.06.29-.122.58-.225.854-.367.986-1.593 1.546-2.926 1.394-.824-.095-1.106-.446-1.342-1.674-.18-.938-.864-1.535-1.681-1.467-.85.07-1.515.829-1.468 1.673.05.892.678 1.44 1.705 1.489 1.375.064 1.75.396 1.926 1.787.067.531.267.967.685 1.288 1.02.783 2.407.208 2.66-1.108l.022-.114c.152-.796.3-1.577 1.04-2.101.36-.255.761-.326 1.166-.397.105-.019.21-.037.315-.06z",
      fill: c.fill
    }), /*#__PURE__*/_jsx("path", {
      d: "M13.83 7.961a.755.755 0 11-1.51 0 .755.755 0 011.51 0z",
      fill: d.fill
    }), /*#__PURE__*/_jsx("path", {
      d: "M10.809 16.678a.755.755 0 100-1.511.755.755 0 000 1.51z",
      fill: e.fill
    }), /*#__PURE__*/_jsxs("defs", {
      children: [/*#__PURE__*/_jsxs("linearGradient", {
        gradientUnits: "userSpaceOnUse",
        id: a.id,
        x1: "12",
        x2: "12",
        y1: "0",
        y2: "24",
        children: [/*#__PURE__*/_jsx("stop", {
          stopColor: "#12B7FA"
        }), /*#__PURE__*/_jsx("stop", {
          offset: "1",
          stopColor: "#006ffb"
        })]
      }), /*#__PURE__*/_jsxs("linearGradient", {
        gradientUnits: "userSpaceOnUse",
        id: b.id,
        x1: "11.943",
        x2: "11.943",
        y1: "6.085",
        y2: "17.778",
        children: [/*#__PURE__*/_jsx("stop", {
          stopColor: "#006ffb"
        }), /*#__PURE__*/_jsx("stop", {
          offset: "1",
          stopColor: "#12B7FA"
        })]
      }), /*#__PURE__*/_jsxs("linearGradient", {
        gradientUnits: "userSpaceOnUse",
        id: c.id,
        x1: "11.943",
        x2: "11.943",
        y1: "6.085",
        y2: "17.778",
        children: [/*#__PURE__*/_jsx("stop", {
          stopColor: "#006ffb"
        }), /*#__PURE__*/_jsx("stop", {
          offset: "1",
          stopColor: "#12B7FA"
        })]
      }), /*#__PURE__*/_jsxs("linearGradient", {
        gradientUnits: "userSpaceOnUse",
        id: d.id,
        x1: "11.943",
        x2: "11.943",
        y1: "6.085",
        y2: "17.778",
        children: [/*#__PURE__*/_jsx("stop", {
          stopColor: "#006ffb"
        }), /*#__PURE__*/_jsx("stop", {
          offset: "1",
          stopColor: "#12B7FA"
        })]
      }), /*#__PURE__*/_jsxs("linearGradient", {
        gradientUnits: "userSpaceOnUse",
        id: e.id,
        x1: "11.943",
        x2: "11.943",
        y1: "6.085",
        y2: "17.778",
        children: [/*#__PURE__*/_jsx("stop", {
          stopColor: "#006ffb"
        }), /*#__PURE__*/_jsx("stop", {
          offset: "1",
          stopColor: "#12B7FA"
        })]
      })]
    })]
  }));
});
export default Icon;