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
  var _useFillIds = useFillIds(TITLE, 6),
    _useFillIds2 = _slicedToArray(_useFillIds, 6),
    a = _useFillIds2[0],
    b = _useFillIds2[1],
    c = _useFillIds2[2],
    d = _useFillIds2[3],
    e = _useFillIds2[4],
    f = _useFillIds2[5];
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
      d: "M19.503 0H4.496A4.496 4.496 0 000 4.496v15.007A4.496 4.496 0 004.496 24h15.007A4.496 4.496 0 0024 19.503V4.496A4.496 4.496 0 0019.503 0z",
      fill: a.fill
    }), /*#__PURE__*/_jsx("path", {
      d: "M9.726 11.36a.306.306 0 110 .612.306.306 0 010-.612z",
      fill: b.fill
    }), /*#__PURE__*/_jsx("path", {
      clipRule: "evenodd",
      d: "M8.408 9.561c.033-.009.065.002.096.033.145.15.292.298.44.447l.021.016c.01.005.017.009.024.01l.608.157c.042.01.068.033.077.066.009.035-.002.067-.033.098l-.447.439a.098.098 0 00-.016.022.1.1 0 00-.01.024l-.157.607c-.01.042-.033.068-.067.077-.034.01-.066-.002-.096-.033l-.44-.446a.117.117 0 00-.047-.027c-.202-.053-.405-.105-.607-.156-.042-.01-.068-.033-.077-.068-.01-.033.002-.066.033-.096.15-.146.298-.292.447-.44a.092.092 0 00.016-.021.101.101 0 00.01-.025l.157-.607c.01-.042.033-.068.068-.077z",
      fill: c.fill,
      fillRule: "evenodd"
    }), /*#__PURE__*/_jsx("path", {
      d: "M14.87 9.982a.307.307 0 110 .613.307.307 0 010-.613z",
      fill: d.fill
    }), /*#__PURE__*/_jsx("path", {
      clipRule: "evenodd",
      d: "M13.553 8.187c.035-.01.067.002.097.032l.438.448a.117.117 0 00.046.026l.606.158c.042.01.067.033.077.068.009.033-.002.065-.034.095l-.447.438a.123.123 0 00-.027.046l-.157.605c-.01.042-.034.068-.068.077-.034.009-.066-.002-.096-.033-.145-.15-.291-.299-.437-.447a.09.09 0 00-.022-.017.09.09 0 00-.025-.01l-.605-.158c-.042-.01-.068-.033-.077-.067-.009-.034.002-.066.033-.096.15-.145.298-.291.447-.437a.093.093 0 00.017-.022.1.1 0 00.01-.025l.158-.605c.01-.042.033-.068.066-.076z",
      fill: e.fill,
      fillRule: "evenodd"
    }), /*#__PURE__*/_jsx("path", {
      clipRule: "evenodd",
      d: "M9.065 3.343a4.577 4.577 0 012.284-.311c1 .114 1.891.54 2.673 1.274a.086.086 0 00.08.022 4.549 4.549 0 013.046.275l.047.021.116.058a4.58 4.58 0 012.188 2.398c.209.51.314 1.041.316 1.595.015.415-.03.823-.135 1.224a.12.12 0 00.03.116c.594.606.988 1.329 1.183 2.168.289 1.426-.007 2.71-.887 3.855l-.136.166a4.546 4.546 0 01-2.201 1.387.12.12 0 00-.08.077c-.191.551-.384 1.023-.741 1.494-.9 1.186-2.221 1.846-3.711 1.838-1.187-.006-2.24-.44-3.157-1.302a.106.106 0 00-.106-.024c-.388.125-.78.144-1.203.139a4.44 4.44 0 01-1.946-.467 4.542 4.542 0 01-1.61-1.336c-.152-.201-.303-.391-.413-.616a5.805 5.805 0 01-.37-.961 4.58 4.58 0 01-.013-2.299.122.122 0 00.005-.055.084.084 0 00-.027-.048 4.466 4.466 0 01-1.035-1.651 3.896 3.896 0 01-.25-1.192 5.183 5.183 0 01.141-1.6c.337-1.112.982-1.985 1.933-2.619.212-.14.412-.25.601-.329.215-.09.43-.165.646-.228a.096.096 0 00.065-.065 4.51 4.51 0 01.828-1.616 4.535 4.535 0 011.839-1.388zm.723 5.735c-.865-.614-2.048-.31-2.483.656-.226.5-.27 1.026-.133 1.58l.108.44.195.712c.08.4.232.765.459 1.096l.022.032c.12.142.252.272.394.389 1.039.854 2.456.284 2.739-.992l.037-.16.01-.06c.044-.3.03-.594-.04-.882a35.608 35.608 0 00-.41-1.517c-.163-.554-.462-.985-.898-1.294zm5.328-1.235c-.646-.6-1.643-.623-2.285-.019-.25.235-.425.552-.523.949a2.603 2.603 0 000 1.226l.01.04.042.136c.095.315.183.625.264.93.085.317.152.53.204.638.43.905 1.365 1.556 2.382 1.141.946-.386 1.23-1.507 1.016-2.415a9.78 9.78 0 00-.105-.41c-.15-.583-.256-.976-.321-1.179a2.41 2.41 0 00-.684-1.037z",
      fill: f.fill,
      fillRule: "evenodd"
    }), /*#__PURE__*/_jsxs("defs", {
      children: [/*#__PURE__*/_jsxs("linearGradient", {
        gradientUnits: "userSpaceOnUse",
        id: a.id,
        x1: "12",
        x2: "12",
        y1: "0",
        y2: "24",
        children: [/*#__PURE__*/_jsx("stop", {
          stopColor: "#012659"
        }), /*#__PURE__*/_jsx("stop", {
          offset: "1",
          stopColor: "#0968DA"
        })]
      }), /*#__PURE__*/_jsxs("linearGradient", {
        gradientUnits: "userSpaceOnUse",
        id: b.id,
        x1: "9.859",
        x2: "14.219",
        y1: "3",
        y2: "21.017",
        children: [/*#__PURE__*/_jsx("stop", {
          stopColor: "#fff"
        }), /*#__PURE__*/_jsx("stop", {
          offset: "1",
          stopColor: "#6BB6FE"
        })]
      }), /*#__PURE__*/_jsxs("linearGradient", {
        gradientUnits: "userSpaceOnUse",
        id: c.id,
        x1: "9.859",
        x2: "14.219",
        y1: "3",
        y2: "21.017",
        children: [/*#__PURE__*/_jsx("stop", {
          stopColor: "#fff"
        }), /*#__PURE__*/_jsx("stop", {
          offset: "1",
          stopColor: "#6BB6FE"
        })]
      }), /*#__PURE__*/_jsxs("linearGradient", {
        gradientUnits: "userSpaceOnUse",
        id: d.id,
        x1: "9.859",
        x2: "14.219",
        y1: "3",
        y2: "21.017",
        children: [/*#__PURE__*/_jsx("stop", {
          stopColor: "#fff"
        }), /*#__PURE__*/_jsx("stop", {
          offset: "1",
          stopColor: "#6BB6FE"
        })]
      }), /*#__PURE__*/_jsxs("linearGradient", {
        gradientUnits: "userSpaceOnUse",
        id: e.id,
        x1: "9.859",
        x2: "14.219",
        y1: "3",
        y2: "21.017",
        children: [/*#__PURE__*/_jsx("stop", {
          stopColor: "#fff"
        }), /*#__PURE__*/_jsx("stop", {
          offset: "1",
          stopColor: "#6BB6FE"
        })]
      }), /*#__PURE__*/_jsxs("linearGradient", {
        gradientUnits: "userSpaceOnUse",
        id: f.id,
        x1: "9.859",
        x2: "14.219",
        y1: "3",
        y2: "21.017",
        children: [/*#__PURE__*/_jsx("stop", {
          stopColor: "#fff"
        }), /*#__PURE__*/_jsx("stop", {
          offset: "1",
          stopColor: "#6BB6FE"
        })]
      })]
    })]
  }));
});
export default Icon;