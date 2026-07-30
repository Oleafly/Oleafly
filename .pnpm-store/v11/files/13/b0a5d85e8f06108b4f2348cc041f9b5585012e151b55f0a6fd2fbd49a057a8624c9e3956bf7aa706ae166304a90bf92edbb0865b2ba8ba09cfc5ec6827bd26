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
  var _useFillIds = useFillIds(TITLE, 7),
    _useFillIds2 = _slicedToArray(_useFillIds, 7),
    a = _useFillIds2[0],
    b = _useFillIds2[1],
    c = _useFillIds2[2],
    d = _useFillIds2[3],
    e = _useFillIds2[4],
    f = _useFillIds2[5],
    g = _useFillIds2[6];
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
      d: "M10.547.232c.776-.086 1.543.244 2.152.712.784.598 1.375 1.434 1.757 2.347.19.444.3.92.345 1.402.01.384.024.781-.108 1.148-.126.406-.362.795-.728 1.017-.352.236-.786.3-1.199.288-.84-.073-1.613-.52-2.212-1.106-.15-.1-.236-.263-.368-.38-.801-.97-1.394-2.203-1.324-3.496.048-.698.38-1.44 1.03-1.75.206-.1.428-.164.655-.182z",
      fill: a.fill
    }), /*#__PURE__*/_jsx("path", {
      d: "M18.595 3.077c.52-.045 1.032.186 1.4.551.402.434.625 1.006.736 1.584.096.605.09 1.233-.048 1.83a5.97 5.97 0 01-.907 2.19c-.198.25-.382.519-.633.719-.493.45-1.181.725-1.848.598-.42-.08-.819-.306-1.085-.646-.514-.591-.687-1.403-.714-2.17a6.11 6.11 0 011.03-3.285c.237-.314.49-.62.797-.867.375-.27.805-.486 1.272-.504z",
      fill: b.fill
    }), /*#__PURE__*/_jsx("path", {
      d: "M5.038 4.172c.618-.045 1.238.067 1.832.235.871.28 1.741.78 2.182 1.624.177.383.256.826.152 1.242-.097.442-.375.816-.71 1.105-.724.59-1.664.84-2.577.887a5.356 5.356 0 01-2.881-.675c-.39-.248-.765-.539-1.025-.93a1.9 1.9 0 01-.327-1.283c.067-.507.357-.968.741-1.289.723-.62 1.684-.873 2.613-.916z",
      fill: c.fill
    }), /*#__PURE__*/_jsx("path", {
      d: "M4.87 10.369c.69-.06 1.465.223 1.811.866.213.349.278.763.29 1.166.006.528-.136 1.046-.34 1.529-.34.793-.893 1.478-1.538 2.036-.64.538-1.42.951-2.26 1.015a2.031 2.031 0 01-1.467-.398c-.353-.281-.578-.707-.662-1.15-.156-.8.077-1.62.445-2.327.196-.377.444-.724.72-1.044.767-.886 1.814-1.608 3.001-1.693z",
      fill: d.fill
    }), /*#__PURE__*/_jsx("path", {
      d: "M20.391 11.05c.881-.087 1.872.116 2.477.822.473.58.534 1.425.239 2.102-.118.317-.32.59-.527.852-.877.962-2.11 1.553-3.379 1.744-.818.123-1.723.036-2.406-.477-.2-.161-.386-.346-.514-.573-.277-.436-.321-.994-.216-1.492.224-.904.92-1.594 1.676-2.073a5.874 5.874 0 012.65-.905z",
      fill: e.fill
    }), /*#__PURE__*/_jsx("path", {
      d: "M7.553 15.523c.381-.052.775.004 1.118.184.344.154.613.427.866.702.866 1.097 1.267 2.549 1.146 3.944a4.476 4.476 0 01-.497 1.61c-.273.469-.663.91-1.187 1.08-.35.103-.731.118-1.077-.005a2.53 2.53 0 01-.959-.612c-.798-.859-1.236-2.02-1.343-3.185-.055-.646-.006-1.31.21-1.923.146-.471.384-.92.738-1.265.261-.277.62-.452.985-.53z",
      fill: f.fill
    }), /*#__PURE__*/_jsx("path", {
      d: "M13.637 16.5a4.237 4.237 0 011.82.219c.795.286 1.542.724 2.148 1.323.535.504.963 1.162 1.099 1.899.055.379.038.785-.122 1.138-.19.465-.599.807-1.051.996-.883.364-1.887.253-2.76-.082a5.568 5.568 0 01-2.343-1.685c-.347-.445-.616-.968-.697-1.534-.042-.382-.036-.788.13-1.142.194-.418.55-.76.978-.925.25-.119.525-.174.798-.207z",
      fill: g.fill
    }), /*#__PURE__*/_jsxs("defs", {
      children: [/*#__PURE__*/_jsxs("linearGradient", {
        gradientUnits: "userSpaceOnUse",
        id: a.id,
        x1: "9.789",
        x2: "13",
        y1: "0",
        y2: "7.5",
        children: [/*#__PURE__*/_jsx("stop", {
          stopColor: "#C65EFF"
        }), /*#__PURE__*/_jsx("stop", {
          offset: ".5",
          stopColor: "#EA4FFF"
        }), /*#__PURE__*/_jsx("stop", {
          offset: "1",
          stopColor: "#9553FF"
        })]
      }), /*#__PURE__*/_jsxs("linearGradient", {
        gradientUnits: "userSpaceOnUse",
        id: b.id,
        x1: "19",
        x2: "17",
        y1: "3",
        y2: "10.5",
        children: [/*#__PURE__*/_jsx("stop", {
          stopColor: "#CF72FF"
        }), /*#__PURE__*/_jsx("stop", {
          offset: ".5",
          stopColor: "#E541FF"
        }), /*#__PURE__*/_jsx("stop", {
          offset: "1",
          stopColor: "#944DFF"
        })]
      }), /*#__PURE__*/_jsxs("linearGradient", {
        gradientUnits: "userSpaceOnUse",
        id: c.id,
        x1: "9",
        x2: "2.5",
        y1: "6.5",
        y2: "8",
        children: [/*#__PURE__*/_jsx("stop", {
          stopColor: "#A555FF"
        }), /*#__PURE__*/_jsx("stop", {
          offset: ".5",
          stopColor: "#DE67FF"
        }), /*#__PURE__*/_jsx("stop", {
          offset: "1",
          stopColor: "#E581FF"
        })]
      }), /*#__PURE__*/_jsxs("linearGradient", {
        gradientUnits: "userSpaceOnUse",
        id: d.id,
        x1: "1",
        x2: "6",
        y1: "12",
        y2: "16",
        children: [/*#__PURE__*/_jsx("stop", {
          stopColor: "#6C48FF"
        }), /*#__PURE__*/_jsx("stop", {
          offset: ".309",
          stopColor: "#AA5AFF"
        }), /*#__PURE__*/_jsx("stop", {
          offset: "1",
          stopColor: "#5145FF"
        })]
      }), /*#__PURE__*/_jsxs("linearGradient", {
        gradientUnits: "userSpaceOnUse",
        id: e.id,
        x1: "19",
        x2: "21",
        y1: "11.5",
        y2: "16.5",
        children: [/*#__PURE__*/_jsx("stop", {
          stopColor: "#CA3EFF"
        }), /*#__PURE__*/_jsx("stop", {
          offset: ".5",
          stopColor: "#AB5CFF"
        }), /*#__PURE__*/_jsx("stop", {
          offset: "1",
          stopColor: "#5042FF"
        })]
      }), /*#__PURE__*/_jsxs("linearGradient", {
        gradientUnits: "userSpaceOnUse",
        id: f.id,
        x1: "6",
        x2: "11",
        y1: "20.5",
        y2: "19",
        children: [/*#__PURE__*/_jsx("stop", {
          stopColor: "#5041FF"
        }), /*#__PURE__*/_jsx("stop", {
          offset: ".26",
          stopColor: "#734FFF"
        }), /*#__PURE__*/_jsx("stop", {
          offset: ".75",
          stopColor: "#6A4CFF"
        }), /*#__PURE__*/_jsx("stop", {
          offset: "1",
          stopColor: "#483FFF"
        })]
      }), /*#__PURE__*/_jsxs("linearGradient", {
        gradientUnits: "userSpaceOnUse",
        id: g.id,
        x1: "12",
        x2: "18.5",
        y1: "17.5",
        y2: "21.5",
        children: [/*#__PURE__*/_jsx("stop", {
          stopColor: "#7B51FF"
        }), /*#__PURE__*/_jsx("stop", {
          offset: ".475",
          stopColor: "#6049FF"
        }), /*#__PURE__*/_jsx("stop", {
          offset: "1",
          stopColor: "#8466FF"
        })]
      })]
    })]
  }));
});
export default Icon;